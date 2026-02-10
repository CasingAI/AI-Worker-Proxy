"""
Example Python client using OpenAI SDK with AI Worker Proxy
"""

from openai import OpenAI

# Initialize client with proxy URL
# Note: Use the base worker URL, model name determines routing
client = OpenAI(
    base_url="https://your-worker.workers.dev/v1/responses",
    api_key="your-secret-proxy-token-here"
)

# Example 1: Simple response with "deep-think" model
print("Example 1: Simple response")
response = client.responses.create(
    model="deep-think",
    instructions="You are a helpful assistant.",
    input="What is the capital of France?"
)
print(response.output_text)
print()

# Example 2: Streaming response with "fast" model
print("Example 2: Streaming response")
stream = client.responses.create(
    model="fast",
    instructions="Write a short poem about AI.",
    input="Write a short poem about AI.",
    stream=True
)

for chunk in stream:
    text = chunk.output[0].content[0].text if chunk.output else chunk.output_text
    if text:
        print(text, end="", flush=True)
print("\n")

# Example 3: Function calling / Tools
print("Example 3: Function calling")
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get the current weather in a given location",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "The city and state, e.g. San Francisco, CA"
                    },
                    "unit": {
                        "type": "string",
                        "enum": ["celsius", "fahrenheit"]
                    }
                },
                "required": ["location"]
            }
        }
    }
]

response = client.responses.create(
    model="deep-think",
    instructions="You can call the tool to fetch weather data.",
    input="What's the weather like in Tokyo?",
    tools=tools
)

print(f"Response text: {response.output_text}")

# Example 4: Using different model configurations
print("\nExample 4: Using different models")

# Use "nvidia" model (routes to NVIDIA AI)
response = client.responses.create(
    model="nvidia",
    instructions="Answer succinctly.",
    input="Quick question: what is 2+2?"
)
print(f"NVIDIA model response: {response.output_text}")

# Use "openai" model (routes to OpenAI)
response = client.responses.create(
    model="openai",
    instructions="You are humorous.",
    input="Tell me a joke"
)
print(f"OpenAI model response: {response.output_text}")
