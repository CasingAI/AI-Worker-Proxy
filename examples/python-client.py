"""
Example Python client using OpenAI SDK with AI Worker Proxy
"""

from openai import OpenAI

# Initialize client with proxy URL
client = OpenAI(
    base_url="https://your-worker.workers.dev/deep-think",
    api_key="your-secret-proxy-token-here"
)

# Example 1: Simple chat completion
print("Example 1: Simple chat completion")
response = client.chat.completions.create(
    model="any-model-name",  # Model is determined by route config
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "What is the capital of France?"}
    ]
)
print(response.choices[0].message.content)
print()

# Example 2: Streaming response
print("Example 2: Streaming response")
stream = client.chat.completions.create(
    model="any-model-name",
    messages=[
        {"role": "user", "content": "Write a short poem about AI."}
    ],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
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

response = client.chat.completions.create(
    model="any-model-name",
    messages=[
        {"role": "user", "content": "What's the weather like in Tokyo?"}
    ],
    tools=tools
)

# Check if the model wants to call a function
if response.choices[0].message.tool_calls:
    tool_call = response.choices[0].message.tool_calls[0]
    print(f"Function called: {tool_call.function.name}")
    print(f"Arguments: {tool_call.function.arguments}")

# Example 4: Using different routes
print("\nExample 4: Using different routes")

# Fast route
fast_client = OpenAI(
    base_url="https://your-worker.workers.dev/fast",
    api_key="your-secret-proxy-token-here"
)

response = fast_client.chat.completions.create(
    model="any-model-name",
    messages=[{"role": "user", "content": "Quick question: what is 2+2?"}]
)
print(f"Fast route response: {response.choices[0].message.content}")
