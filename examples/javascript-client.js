/**
 * Example JavaScript/Node.js client using AI Worker Proxy
 */

const BASE_URL = 'https://your-worker.workers.dev/v1/responses';
const API_KEY = 'your-secret-proxy-token-here';

// Example 1: Simple fetch with streaming
async function streamingExample() {
  console.log('Example 1: Streaming response');

  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: 'deep-think', // Model name determines routing
      instructions: 'You are a helpful storyteller.',
      input: 'Tell me a short story about a robot.',
      stream: true,
    })
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
        const chunkContent =
          parsed.output?.[0]?.content?.[0]?.text ||
          parsed.output_text ||
          '';
        if (chunkContent) {
          process.stdout.write(chunkContent);
        }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
  }
  console.log('\n');
}

// Example 2: Non-streaming request
async function nonStreamingExample() {
  console.log('Example 2: Non-streaming response');

  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: 'fast', // Different model = different providers
      instructions: 'You are a helpful math tutor.',
      input: 'What is 2+2?',
      stream: false,
    })
  });

  const data = await response.json();
  console.log(data.output_text);
  console.log();
}

// Example 3: Using OpenAI SDK (install with: npm install openai)
async function openaiSdkExample() {
  const OpenAI = require('openai');

  const client = new OpenAI({
    baseURL: BASE_URL,
    apiKey: API_KEY
  });

  console.log('Example 3: Using OpenAI SDK');

  const stream = await client.responses.create({
    model: 'deep-think', // Model name for routing
    instructions: 'You are a counting assistant.',
    input: 'Count from 1 to 5.',
    stream: true,
  });

  for await (const chunk of stream) {
    const content = chunk.output?.[0]?.content?.[0]?.text;
    if (content) {
      process.stdout.write(content);
    }
  }
  console.log('\n');
}

// Example 4: Function calling
async function functionCallingExample() {
  console.log('Example 4: Function calling');

  const response = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: 'deep-think', // Function calling works with any model
      instructions: 'You can call tools to get weather data.',
      input: "What's the weather in London?",
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get current weather',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string' }
              },
              required: ['location']
            }
          }
        }
      ]
    })
  });

  const data = await response.json();

  if (data.output_text) {
    console.log('Assistant response:', data.output_text);
  }
  console.log();
}

// Run examples
(async () => {
  await streamingExample();
  await nonStreamingExample();
  await functionCallingExample();
  // await openaiSdkExample(); // Uncomment if you have openai package installed
})();
