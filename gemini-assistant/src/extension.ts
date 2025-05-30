import * as vscode from 'vscode';
import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory, ChatSession } from '@google/generative-ai'; // Import ChatSession

// Define constants for secret key name and webview properties
const GEMINI_API_KEY_SECRET_NAME = 'geminiApiKey';
const CHAT_VIEW_TYPE = 'geminiAssistantChat'; // Must match the viewType used in package.json
const CHAT_PANEL_TITLE = 'Gemini Assistant Chat'; // Title for the webview panel

export function activate(context: vscode.ExtensionContext) {

    console.log('Congratulations, your extension "gemini-assistant" is now active!');

    // --- Register the "Hello World" command (already exists) ---
    let helloWorldDisposable = vscode.commands.registerCommand('gemini-assistant.helloWorld', () => {
        vscode.window.showInformationMessage('Hello World from Gemini Assistant!');
    });
    context.subscriptions.push(helloWorldDisposable);


    // --- Register the "Set Gemini API Key" command ---
    let setApiKeyDisposable = vscode.commands.registerCommand('gemini-assistant.setApiKey', async () => {
        const apiKey = await vscode.window.showInputBox({
            prompt: 'Enter your Gemini API Key',
            ignoreFocusOut: true, // Keep input box open if focus is lost
            password: true // Hide input for security
        });

        if (apiKey) {
            // Store the API key securely using VS Code's SecretStorage
            await context.secrets.store(GEMINI_API_KEY_SECRET_NAME, apiKey);
            vscode.window.showInformationMessage('Gemini API Key stored securely!');
            // If the panel is open, tell it the key might have changed
            if (GeminiChatPanel.currentPanel) {
                GeminiChatPanel.currentPanel.notifyApiKeyChanged();
            }
        } else {
            vscode.window.showWarningMessage('Gemini API Key not entered. It was not stored.');
        }
    });
    context.subscriptions.push(setApiKeyDisposable);


    // --- Register the "Delete Gemini API Key" command ---
    let deleteApiKeyDisposable = vscode.commands.registerCommand('gemini-assistant.deleteApiKey', async () => {
        const confirm = await vscode.window.showInformationMessage(
            'Are you sure you want to delete your stored Gemini API Key?',
            { modal: true }, // Make this a modal dialog
            'Yes', 'No'
        );

        if (confirm === 'Yes') {
            // Delete the API key from SecretStorage
            await context.secrets.delete(GEMINI_API_KEY_SECRET_NAME);
            vscode.window.showInformationMessage('Gemini API Key deleted.');
            // If the panel is open, tell it the key might have changed
            if (GeminiChatPanel.currentPanel) {
                GeminiChatPanel.currentPanel.notifyApiKeyChanged();
            }
        } else {
            vscode.window.showInformationMessage('Gemini API Key deletion cancelled.');
        }
    });
    context.subscriptions.push(deleteApiKeyDisposable);


    // --- Register a command to Test API Key Retrieval (for development/verification) ---
    let testApiKeyDisposable = vscode.commands.registerCommand('gemini-assistant.testApiKey', async () => {
        const storedApiKey = await context.secrets.get(GEMINI_API_KEY_SECRET_NAME);
        if (storedApiKey) {
            // For demonstration, we'll show a partial key. NEVER log the full key in a real extension.
            const partialKey = storedApiKey.substring(0, 5) + '...' + storedApiKey.substring(storedApiKey.length - 5);
            vscode.window.showInformationMessage(`Gemini API Key found: ${partialKey}`);
            console.log('Full API Key (for debug, not for production):', storedApiKey); // For your console debug
        } else {
            vscode.window.showWarningMessage('No Gemini API Key found. Please set it first.');
        }
    });
    context.subscriptions.push(testApiKeyDisposable);

    // --- Register the "Start New Gemini Chat" command ---
    let startChatDisposable = vscode.commands.registerCommand('gemini-assistant.startChat', () => {
        GeminiChatPanel.createOrShow(context.extensionUri, context);
    });
    context.subscriptions.push(startChatDisposable);

    // --- Register a command to List Available Gemini Models ---
    let listModelsDisposable = vscode.commands.registerCommand('gemini-assistant.listModels', async () => {
        const apiKey = await context.secrets.get(GEMINI_API_KEY_SECRET_NAME);

        if (!apiKey) {
            vscode.window.showWarningMessage('Gemini API Key not set. Cannot list models.');
            return;
        }

        try {
            const genAI = new GoogleGenerativeAI(apiKey);
            // The `listModels` method on GoogleGenerativeAI might still show a TypeScript error
            // in your editor due to an unresolved environmental issue, but the direct API call method worked.
            const { models } = await genAI.listModels(); // Fetch the list of models

            vscode.window.showInformationMessage('Listing available Gemini models in Debug Console.');
            console.log('--- Available Gemini Models ---');
            for (const model of models) {
                console.log(`ID: ${model.name}`);
                console.log(`  Description: ${model.description}`);
                console.log(`  Supported Methods: ${model.supportedGenerationMethods?.join(', ') || 'None'}`);
                console.log('-----------------------------');
            }
            console.log('--- End of Model List ---');

        } catch (error: any) {
            console.error('Error listing Gemini models:', error);
            vscode.window.showErrorMessage(`Failed to list Gemini models: ${error.message || error}`);
        }
    });
    context.subscriptions.push(listModelsDisposable);

    // --- Register the command to reset chat history ---
    // This command needs to be added to package.json under 'contributes.commands'
    // {
    //   "command": "gemini-assistant.resetChat",
    //   "title": "Reset Gemini Chat"
    // }
    let resetChatDisposable = vscode.commands.registerCommand('gemini-assistant.resetChat', () => {
        if (GeminiChatPanel.currentPanel) {
            GeminiChatPanel.currentPanel.resetChatSession();
            vscode.window.showInformationMessage('Gemini chat history reset.');
        } else {
            vscode.window.showInformationMessage('No active Gemini chat panel to reset.');
        }
    });
    context.subscriptions.push(resetChatDisposable);

}

// This method is called when your extension is deactivated
export function deactivate() { }


/**
 * Manages gemini chat webview panels
 */
class GeminiChatPanel {
    /**
     * Track the currently active panel. Only allow a single panel to exist at a time.
     */
    public static currentPanel: GeminiChatPanel | undefined;

    public static readonly viewType = CHAT_VIEW_TYPE; // Must match the viewType used in package.json

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private readonly _context: vscode.ExtensionContext; // Added: Store context for API key retrieval
    private _disposables: vscode.Disposable[] = [];
    private _chat: ChatSession | undefined; // ADD THIS LINE: To store the chat session

    // Add constants for generation and safety settings as class properties
    private readonly _generationConfig = {
        temperature: 0.7, // Adjust creativity (0.0 - 1.0)
        topK: 1,
        topP: 1,
        maxOutputTokens: 2048,
    };

    private readonly _safetySettings = [
        {
            category: HarmCategory.HARM_CATEGORY_HARASSMENT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
            category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
            category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
            category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
    ];


    public static createOrShow(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it.
        if (GeminiChatPanel.currentPanel) {
            GeminiChatPanel.currentPanel._panel.reveal(column);
            return;
        }

        // Otherwise, create a new panel.
        const panel = vscode.window.createWebviewPanel(
            GeminiChatPanel.viewType,
            CHAT_PANEL_TITLE,
            column || vscode.ViewColumn.One,
            {
                // Enable javascript in the webview
                enableScripts: true,

                // And restrict the webview to only loading content from our extension's `dist` directory.
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')]
            }
        );

        // Pass context to the constructor
        GeminiChatPanel.currentPanel = new GeminiChatPanel(panel, extensionUri, context);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._context = context; // Store the context
        this._chat = undefined; // Initialize chat session to undefined

        // Set the webview's initial html content
        this._update();

        // Listen for when the panel is disposed
        // This happens when the user closes the panel or when the extension is deactivated
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Update the content based on view state changes
        this._panel.onDidChangeViewState(
            e => {
                if (this._panel.visible) {
                    this._update();
                }
            },
            null,
            this._disposables
        );

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'prompt':
                        const userPrompt = message.text;
                        this.handlePrompt(userPrompt); // Delegate to a new method
                        break;
                    case 'alert':
                        vscode.window.showErrorMessage(message.text);
                        break;
                    case 'newChat': // Handle request from webview to start a new chat
                        this.resetChatSession();
                        vscode.window.showInformationMessage('New chat started.');
                        // Send a message to webview to clear its display and show initial message
                        this._panel.webview.postMessage({ command: 'clearChatAndGreet' });
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    // New method to handle incoming prompts and manage chat session
    private async handlePrompt(userPrompt: string) {
        const apiKey = await this._context.secrets.get(GEMINI_API_KEY_SECRET_NAME);

        if (!apiKey) {
            this._panel.webview.postMessage({ command: 'error', text: 'Gemini API Key not set. Please set it using "Set Gemini API Key" command.' });
            return;
        }

        try {
            // Initialize the chat session if it doesn't exist
            if (!this._chat) {
                const genAI = new GoogleGenerativeAI(apiKey);
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
                this._chat = model.startChat({
                    generationConfig: this._generationConfig,
                    safetySettings: this._safetySettings,
                    history: [], // Start with empty history if new session
                });
                console.log('New Gemini chat session started.');
            }

            // Send the message using the *existing* chat session
            const result = await this._chat.sendMessage(userPrompt);
            const response = await result.response;
            const text = response.text();

            // Send the actual AI response back to the webview
            this._panel.webview.postMessage({ command: 'response', text: text });

        } catch (error: any) {
            console.error('Gemini API Error:', error);
            // Send error message back to webview and show as VS Code notification
            this._panel.webview.postMessage({ command: 'error', text: `Failed to get response from Gemini: ${error.message || error}` });
            vscode.window.showErrorMessage(`Gemini API Error: ${error.message || error}`);
        }
    }

    // Method to reset the chat session
    public resetChatSession() {
        this._chat = undefined; // Simply clear the stored chat session
        console.log('Gemini chat session reset.');
        // Notify webview to clear its display and show initial message
        this._panel.webview.postMessage({ command: 'clearChatAndGreet', text: 'Chat history cleared.' });
    }

    // Method to notify webview if API key changes (optional, but good practice)
    public notifyApiKeyChanged() {
        this._panel.webview.postMessage({
            command: 'systemMessage',
            text: 'API Key updated. You may want to start a new chat for full effect or reset the chat history.'
        });
        // You might consider implicitly resetting the chat session here, but letting the user decide
        // by starting a new chat or resetting via command is often better for user control.
    }


    public dispose() {
        GeminiChatPanel.currentPanel = undefined;
        this._chat = undefined; // Ensure chat session is cleared on dispose

        // Clean up our resources
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _update() {
        const webview = this._panel.webview;
        this._panel.title = CHAT_PANEL_TITLE; // Ensure title is set correctly
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Local path to main script run in the webview
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js'));

        // Local path to CSS styles
        const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'reset.css'));
        const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'vscode.css'));
        const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'main.css'));

        // Use a nonce to only allow a specific script to be run.
        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleResetUri}" rel="stylesheet">
                <link href="${styleVSCodeUri}" rel="stylesheet">
                <link href="${styleMainUri}" rel="stylesheet">
                <title>${CHAT_PANEL_TITLE}</title>
            </head>
            <body>
                <div class="chat-container">
                    <div id="chat-messages" class="chat-messages">
                        </div>
                    <div class="chat-input-container">
                        <textarea id="chat-input" class="chat-input" placeholder="Type your message..." rows="1"></textarea>
                        <button id="send-button" class="send-button">Send</button>
                    </div>
                </div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}