import { BaseProvider } from './base';
import { OpenAIChatRequest, ProviderResponse, OpenAIMessage, Tool, ToolCall } from '../types';
import { createOpenAIResponse, createStreamChunk } from '../utils/response-mapper';

export class CloudflareAIProvider extends BaseProvider {
  constructor(
    model: string,
    private aiBinding: any
  ) {
    super(model);
  }

  async chat(request: OpenAIChatRequest, _apiKey: string): Promise<ProviderResponse> {
    try {
      if (!this.aiBinding) {
        throw new Error('Cloudflare AI binding not available');
      }

      // Convert OpenAI messages to Cloudflare AI format
      const messages = this.convertMessages(request.messages);

      const params: any = {
        messages,
        max_tokens: request.max_tokens,
        temperature: request.temperature,
        top_p: request.top_p,
        stream: request.stream || false,
      };

      // Add tools if present
      if (request.tools && request.tools.length > 0) {
        params.tools = this.convertTools(request.tools);
      }

      if (request.stream) {
        return this.handleStream(params);
      } else {
        return this.handleNonStream(params);
      }
    } catch (error) {
      return this.handleError(error, 'CloudflareAIProvider');
    }
  }

  private async handleNonStream(params: any): Promise<ProviderResponse> {
    const response = await this.aiBinding.run(this.model, params);

    // Cloudflare AI response format
    let content = '';
    if (response.response) {
      content = response.response;
    } else if (typeof response === 'string') {
      content = response;
    }

    const openAIResponse = createOpenAIResponse(content, this.model);

    // Handle tool calls if present
    if (response.tool_calls && response.tool_calls.length > 0) {
      openAIResponse.choices[0].message.tool_calls = this.convertToolCalls(response.tool_calls);
      openAIResponse.choices[0].message.content = null; // No content when there are tool calls
      openAIResponse.choices[0].finish_reason = 'tool_calls';
    }

    return {
      success: true,
      response: openAIResponse,
    };
  }

  private async handleStream(params: any): Promise<ProviderResponse> {
    const cfStream = await this.aiBinding.run(this.model, params);

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Process stream in background
    (async () => {
      try {
        let isFirst = true;

        // Cloudflare AI returns a ReadableStream
        const reader = cfStream.getReader();

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Parse the chunk - Cloudflare AI might send different formats
          let text = '';
          let toolCalls: any[] | undefined;

          if (typeof value === 'string') {
            text = value;
          } else if (value.response) {
            text = value.response;
            // Check for tool calls in streaming response
            if (value.tool_calls) {
              toolCalls = value.tool_calls;
            }
          } else {
            // Try to decode if it's bytes
            const decoder = new TextDecoder();
            text = decoder.decode(value);
          }

          // Send tool calls if present
          if (toolCalls && toolCalls.length > 0) {
            const delta = isFirst
              ? {
                  role: 'assistant' as const,
                  tool_calls: this.convertToolCalls(toolCalls),
                }
              : {
                  tool_calls: this.convertToolCalls(toolCalls),
                };

            const chunk = createStreamChunk(delta, this.model);
            await writer.write(encoder.encode(chunk));
            isFirst = false;
          } else if (text) {
            const delta = isFirst
              ? { content: text, role: 'assistant' as const }
              : { content: text };

            const chunk = createStreamChunk(delta, this.model);
            await writer.write(encoder.encode(chunk));
            isFirst = false;
          }
        }

        // Send final chunk
        const finishReason = params.tools ? 'tool_calls' : 'stop';
        const finishChunk = createStreamChunk({}, this.model, finishReason);
        await writer.write(encoder.encode(finishChunk));
        await writer.write(encoder.encode('data: [DONE]\n\n'));
      } catch (error) {
        console.error('Stream error:', error);
      } finally {
        await writer.close();
      }
    })();

    return {
      success: true,
      stream: readable,
    };
  }

  private convertMessages(messages: OpenAIMessage[]): any[] {
    return messages.map((msg) => {
      // Handle tool role -> user with tool content
      if (msg.role === 'tool') {
        return {
          role: 'user',
          content: msg.content || '',
        };
      }

      // Handle assistant messages with tool calls
      if (msg.role === 'assistant' && msg.tool_calls) {
        // For messages with tool calls, we might need to format them specially
        // For now, just return the content
        return {
          role: 'assistant',
          content: msg.content || '',
        };
      }

      return {
        role: msg.role === 'system' ? 'user' : msg.role, // CF AI treats system as user
        content: msg.content || '',
      };
    });
  }

  // Convert OpenAI tools format to Cloudflare AI format
  private convertTools(tools: Tool[]): any[] {
    return tools.map((tool) => {
      // Cloudflare AI supports both formats:
      // 1. Direct format: { name, description, parameters }
      // 2. OpenAI format: { type: "function", function: { name, description, parameters } }

      if (tool.type === 'function') {
        // Return OpenAI-compatible format (Cloudflare supports this)
        return {
          type: 'function',
          function: {
            name: tool.function.name,
            description: tool.function.description || '',
            parameters: tool.function.parameters || {
              type: 'object',
              properties: {},
            },
          },
        };
      }

      return tool;
    });
  }

  // Convert Cloudflare AI tool_calls to OpenAI format
  private convertToolCalls(cfToolCalls: any[]): ToolCall[] {
    return cfToolCalls.map((call, index) => ({
      id: `call_${Date.now()}_${index}`, // Generate ID as CF doesn't provide one
      type: 'function' as const,
      function: {
        name: call.name,
        arguments: JSON.stringify(call.arguments),
      },
    }));
  }
}
