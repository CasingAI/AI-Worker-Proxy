import Anthropic from '@anthropic-ai/sdk';
import { BaseProvider } from './base';
import { OpenAIChatRequest, ProviderResponse, OpenAIMessage, ToolCall } from '../types';
import { createProxyResponse, createProxyStreamChunk, createResponseStartedChunk, createStreamIds } from '../utils/response-mapper';
import { normalizeMessages } from '../utils/request';
import { normalizeFunctionTools } from '../utils/tool-normalizer';

export class AnthropicProvider extends BaseProvider {
  async chat(request: OpenAIChatRequest, apiKey: string): Promise<ProviderResponse> {
    try {
      const client = new Anthropic({ apiKey });

      // Convert OpenAI messages to Anthropic format
      const messages = normalizeMessages(request);
      const { system, messages: anthropicMessages } = this.convertMessages(messages);

      // Convert tools if present
      const normalizedTools = normalizeFunctionTools(request.tools);
      const tools = normalizedTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }));

      const params: any = {
        model: this.model,
        messages: anthropicMessages,
        max_tokens: request.max_tokens || 4096,
        temperature: request.temperature,
        top_p: request.top_p,
        stream: request.stream || false,
      };

      if (system) {
        params.system = system;
      }

      if (tools && tools.length > 0) {
        params.tools = tools;
      }

      if (request.stream) {
        return this.handleStream(client, params);
      } else {
        return this.handleNonStream(client, params);
      }
    } catch (error) {
      return this.handleError(error, 'AnthropicProvider');
    }
  }

  private async handleNonStream(client: Anthropic, params: any): Promise<ProviderResponse> {
    const response = await client.messages.create(params);

    let content = '';

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      }
    }

    const openAIResponse = createProxyResponse(content, this.model);

    return {
      success: true,
      response: openAIResponse,
    };
  }

  private async handleStream(client: Anthropic, params: any): Promise<ProviderResponse> {
    const stream = await client.messages.stream(params);
    const { responseId, itemId } = createStreamIds();

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Process stream in background
    (async () => {
      try {
        await writer.write(encoder.encode(createResponseStartedChunk(responseId, itemId, this.model)));
 
        let fullText = '';
        let toolCallBuffer: any = null;

        for await (const event of stream) {
          if (event.type === 'content_block_start') {
            if (event.content_block.type === 'tool_use') {
              toolCallBuffer = {
                id: event.content_block.id,
                name: event.content_block.name,
                input: '',
              };
            }
          } else if (event.type === 'content_block_delta') {
            if (event.delta.type === 'text_delta') {
              const text = event.delta.text;
              fullText += text;
              const chunk = createProxyStreamChunk(text, this.model, 'in_progress', {
                responseId,
                itemId,
              });
              await writer.write(encoder.encode(chunk));
            } else if (event.delta.type === 'input_json_delta' && toolCallBuffer) {
              toolCallBuffer.input += event.delta.partial_json;
            }
          } else if (event.type === 'content_block_stop') {
            if (toolCallBuffer) {
              // Send tool call
              const toolCall: ToolCall = {
                id: toolCallBuffer.id,
                type: 'function',
                function: {
                  name: toolCallBuffer.name,
                  arguments: toolCallBuffer.input,
                },
              };
              void toolCall;
              toolCallBuffer = null;
            }
          } else if (event.type === 'message_stop') {
            const chunk = createProxyStreamChunk('', this.model, 'completed', {
              responseId,
              itemId,
              outputText: fullText,
            });
            await writer.write(encoder.encode(chunk));
            await writer.write(encoder.encode('data: [DONE]\n\n'));
          }
        }
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

  private convertMessages(messages: OpenAIMessage[]): {
    system?: string;
    messages: Anthropic.MessageParam[];
  } {
    let system: string | undefined;
    const convertedMessages: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        system = msg.content || '';
      } else if (msg.role === 'user' || msg.role === 'assistant') {
        const content: any[] = [];

        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }

        if (msg.tool_calls) {
          for (const toolCall of msg.tool_calls) {
            content.push({
              type: 'tool_use',
              id: toolCall.id,
              name: toolCall.function.name,
              input: JSON.parse(toolCall.function.arguments),
            });
          }
        }

        convertedMessages.push({
          role: msg.role,
          content,
        });
      } else if (msg.role === 'tool') {
        // Tool result
        convertedMessages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.tool_call_id!,
              content: msg.content || '',
            },
          ],
        });
      }
    }

    return { system, messages: convertedMessages };
  }
}
