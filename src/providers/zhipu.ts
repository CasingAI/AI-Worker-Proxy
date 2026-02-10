import OpenAI from 'openai';
import { BaseProvider } from './base';
import { OpenAIChatRequest, ProviderResponse, Tool } from '../types';
import { createProxyResponse, createProxyStreamChunk, createResponseStartedChunk, createStreamIds } from '../utils/response-mapper';
import { normalizeMessages } from '../utils/request';

const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4/';

export class ZhipuProvider extends BaseProvider {
  constructor(model: string, baseUrl?: string) {
    super(model, baseUrl ?? DEFAULT_BASE_URL);
  }

  async chat(request: OpenAIChatRequest, apiKey: string): Promise<ProviderResponse> {
    try {
      const client = new OpenAI({
        apiKey,
        baseURL: this.baseUrl,
      });

      const messages = this.buildMessages(request);
      const maxTokens = request.max_tokens ?? request.max_output_tokens;

      const baseParams: OpenAI.ChatCompletionCreateParams = {
        model: this.model,
        messages,
        temperature: request.temperature,
        top_p: request.top_p,
        stop: request.stop,
        max_tokens: maxTokens ?? undefined,
        stream: Boolean(request.stream),
        tools: mapToolsToChatTools(request.tools),
        tool_choice: mapToolChoice(request.tool_choice),
      };

      if (request.stream) {
        return this.handleStream(
        client,
        baseParams as OpenAI.ChatCompletionCreateParamsStreaming
        );
      }

      const nonStreamParams: OpenAI.ChatCompletionCreateParamsNonStreaming = {
        ...baseParams,
        stream: false,
      };

      return this.handleNonStream(client, nonStreamParams);
    } catch (error) {
      return this.handleError(error, 'ZhipuProvider');
    }
  }

  private async handleNonStream(
    client: OpenAI,
    params: OpenAI.ChatCompletionCreateParamsNonStreaming
  ): Promise<ProviderResponse> {
    const response = await client.chat.completions.create(params);
    const content = this.extractAssistantMessage(response.choices?.[0]?.message);

    return {
      success: true,
      response: createProxyResponse(content, this.model),
    };
  }

  private async handleStream(
    client: OpenAI,
    params: OpenAI.ChatCompletionCreateParamsStreaming
  ): Promise<ProviderResponse> {
    const stream = await client.chat.completions.create(params);
    const { responseId, itemId } = createStreamIds();

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    (async () => {
      try {
        await writer.write(encoder.encode(createResponseStartedChunk(responseId, itemId, this.model)));
 
        let fullText = '';
        for await (const chunk of stream) {
          const content = chunk.choices?.[0]?.delta?.content;

          if (content) {
            fullText += content;
            const chunkData = createProxyStreamChunk(content, this.model, 'in_progress', {
              responseId,
              itemId,
            });
            await writer.write(encoder.encode(chunkData));
          }
        }

        const finishChunk = createProxyStreamChunk('', this.model, 'completed', {
          responseId,
          itemId,
          outputText: fullText,
        });
        await writer.write(encoder.encode(finishChunk));
        await writer.write(encoder.encode('data: [DONE]\n\n'));
      } catch (error) {
        console.error('ZhipuProvider stream error:', error);
      } finally {
        await writer.close();
      }
    })();

    return {
      success: true,
      stream: readable,
    };
  }

  private buildMessages(request: OpenAIChatRequest): OpenAI.ChatCompletionMessageParam[] {
    const normalized = [...normalizeMessages(request)];
    const instructions = request.instructions?.trim();

    if (
      instructions &&
      !normalized.some((message) => message.role === 'system' || message.role === 'developer')
    ) {
      normalized.unshift({
        role: 'system',
        content: instructions,
      });
    }

    return normalized.map((message) => ({
      role: message.role,
      content: message.content ?? '',
      name: message.name,
      tool_calls: message.tool_calls?.map((toolCall) => ({
        id: toolCall.id,
        type: toolCall.type,
        function: {
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
        },
      })),
      tool_call_id: message.tool_call_id,
    })) as OpenAI.ChatCompletionMessageParam[];
  }

  private extractAssistantMessage(message?: OpenAI.ChatCompletionMessage): string {
    if (!message) {
      return '';
    }

    return message.content ?? '';
  }
}

function mapToolsToChatTools(tools?: Tool[]): OpenAI.ChatCompletionTool[] | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.function.name,
      description: tool.function.description || '',
      parameters: tool.function.parameters || {},
    },
  }));
}

function mapToolChoice(
  choice?: OpenAIChatRequest['tool_choice']
): OpenAI.ChatCompletionToolChoiceOption | undefined {
  if (!choice) {
    return undefined;
  }

  if (choice === 'auto' || choice === 'none') {
    return choice;
  }

  if (choice.type === 'function') {
    return {
      type: 'function',
      function: {
        name: choice.function.name,
      },
    };
  }

  return undefined;
}
