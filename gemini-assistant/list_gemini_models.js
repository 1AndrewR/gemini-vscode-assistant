// list_gemini_models.js
// If your Node.js version is < 18, you might need to uncomment the line below.
// const fetch = require('node-fetch'); // If you installed node-fetch@2

// !!! IMPORTANT: Replace 'YOUR_GEMINI_API_KEY_HERE' with your actual API Key copied from VS Code's Debug Console !!!
const API_KEY = 'AIzaSyCVtw-ihBzoUdOsIZVYq6YpvcRb4E_XZlk'; // Paste your actual key here

async function listModelsDirectly() {
  if (API_KEY === 'YOUR_GEMINI_API_KEY_HERE' || !API_KEY) {
    console.error('Error: Please replace "YOUR_GEMINI_API_KEY_HERE" with your actual Gemini API Key.');
    return;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      // Handle HTTP errors
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }
    const data = await response.json();

    if (data.models && data.models.length > 0) {
      console.log('--- Available Gemini Models (Direct API Call) ---');
      for (const model of data.models) {
        console.log(`ID: ${model.name}`);
        console.log(`  Description: ${model.description}`);
        console.log(`  Supported Methods: ${model.supportedGenerationMethods ? model.supportedGenerationMethods.join(', ') : 'None'}`);
        console.log('-----------------------------');
      }
      console.log('--- End of Model List ---');
    } else {
      console.log('No models found for this API key/region.');
    }

  } catch (error) {
    console.error('Error listing Gemini models (Direct API Call):', error.message || error);
  }
}

listModelsDirectly(); // Call the new function