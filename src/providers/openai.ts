import OpenAI from 'openai';
import { BaseProvider } from './base';
import { OpenAIChatRequest, ProviderResponse, Tool } from '../types';
import { buildResponseInput, extractInstructions } from '../utils/request';
import { mapToolChoiceToResponses, normalizeFunctionTools } from '../utils/tool-normalizer';

export class OpenAIProvider extends BaseProvider {
  async chat(request: OpenAIChatRequest, apiKey: string): Promise<ProviderResponse> {
    try {
      const client = new OpenAI({
        apiKey,
        baseURL: this.baseUrl,
      });

      const baseParams: Omit<OpenAI.Responses.ResponseCreateParams, 'stream'> = {
        model: this.model,
        input: ((request.input ?? buildResponseInput(request)) as any) ?? '',
        instructions: extractInstructions(request),
        temperature: request.temperature,
        top_p: request.top_p,
        max_output_tokens: request.max_output_tokens ?? request.max_tokens,
        tools: mapToolsToResponses(request.tools),
        tool_choice: mapToolChoiceToResponses(request.tool_choice) as any,
        previous_response_id: request.previous_response_id,
        store: request.store,
      };

      if (request.stream) {
        const streamParams: OpenAI.Responses.ResponseCreateParamsStreaming = {
          ...baseParams,
          stream: true,
        };
        return this.handleStream(client, streamParams);
      }

      const nonStreamParams: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
        ...baseParams,
        stream: false,
      };
      return this.handleNonStream(client, nonStreamParams);
    } catch (error) {
      return this.handleError(error, 'OpenAIProvider');
    }
  }

  private async handleNonStream(
    client: OpenAI,
    params: OpenAI.Responses.ResponseCreateParamsNonStreaming
  ): Promise<ProviderResponse> {
    const response = await client.responses.create(params);

    return {
      success: true,
      response,
    };
  }

  private async handleStream(
    client: OpenAI,
    params: OpenAI.Responses.ResponseCreateParamsStreaming
  ): Promise<ProviderResponse> {
    const stream = await client.responses.create(params);

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    (async () => {
      try {
        for await (const chunk of stream) {
          const data = `data: ${JSON.stringify(chunk)}\n\n`;
          await writer.write(encoder.encode(data));
        }

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
}

function mapToolsToResponses(tools?: Tool[]): OpenAI.Responses.Tool[] | undefined {
  const normalizedTools = normalizeFunctionTools(tools);
  if (normalizedTools.length === 0) {
    return undefined;
  }

  return normalizedTools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: tool.strict,
  }));
}
