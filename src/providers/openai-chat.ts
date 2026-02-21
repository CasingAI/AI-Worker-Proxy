/**
 * OpenAI 格式 Chat Completions 统一 provider（智谱等兼容接口）。
 * 严格使用 responses.js 的 Chat → Responses 转换逻辑（见 utils/chat-to-responses）。
 */

import OpenAI from 'openai';
import { BaseProvider } from './base';
import { OpenAIChatRequest, ProviderResponse, ReasoningEffort } from '../types';
import type { IncompleteResponse } from '../utils/chat-to-responses';
import {
  inputToChatMessages,
  openaiMessagesToChatParams,
  buildChatPayload,
  createIncompleteResponse,
  streamChatToResponseEvents,
  toCompletedResponse,
  generateUniqueId,
} from '../utils/chat-to-responses';
import { normalizeMessages, extractInstructions } from '../utils/request';

const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1';

export class OpenAIChatProvider extends BaseProvider {
  constructor(model: string, endpoint?: string) {
    super(model, endpoint ?? DEFAULT_OPENAI_BASE);
  }

  async chat(
    request: OpenAIChatRequest,
    apiKey: string,
    _reasoningEffort?: ReasoningEffort
  ): Promise<ProviderResponse> {
    try {
      const client = new OpenAI({
        apiKey,
        baseURL: this.endpoint,
      });

      const messages =
        request.input !== undefined
          ? inputToChatMessages(request)
          : openaiMessagesToChatParams(normalizeMessages(request), extractInstructions(request));

      const payload = buildChatPayload(request, this.model, messages);

      if (request.stream) {
        return this.handleStream(client, payload, request);
      }
      return this.handleNonStream(client, payload, request);
    } catch (error) {
      return this.handleError(error, 'OpenAIChatProvider');
    }
  }

  private async handleNonStream(
    client: OpenAI,
    payload: Parameters<OpenAI['chat']['completions']['create']>[0],
    request: OpenAIChatRequest
  ): Promise<ProviderResponse> {
    const response = await client.chat.completions.create({
      ...payload,
      stream: false,
    });

    const responseObject: IncompleteResponse = createIncompleteResponse(request, this.model);
    const message = response.choices?.[0]?.message;
    const content = message?.content ?? '';

    if (message?.tool_calls?.length) {
      for (const tc of message.tool_calls) {
        responseObject.output.push({
          type: 'function_call',
          id: generateUniqueId('fc'),
          call_id: tc.id ?? '',
          name: tc.function?.name ?? '',
          arguments: tc.function?.arguments ?? '',
          status: 'completed',
        } as import('openai/resources/responses/responses').ResponseOutputItem.FunctionCall);
      }
    }

    if (content || responseObject.output.length === 0) {
      responseObject.output.unshift({
        id: generateUniqueId('msg'),
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: content, annotations: [] }],
      } as import('openai/resources/responses/responses').ResponseOutputItem.Message);
    }

    if (response.usage) {
      responseObject.usage = {
        input_tokens: response.usage.prompt_tokens ?? 0,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: response.usage.completion_tokens ?? 0,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: response.usage.total_tokens ?? 0,
      };
    }

    const finalResponse = toCompletedResponse(responseObject);
    return { success: true, response: finalResponse };
  }

  private async handleStream(
    client: OpenAI,
    payload: import('openai/resources/chat/completions').ChatCompletionCreateParamsStreaming,
    request: OpenAIChatRequest
  ): Promise<ProviderResponse> {
    const stream = await client.chat.completions.create(payload);
    const responseObject: IncompleteResponse = createIncompleteResponse(request, this.model);

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    (async () => {
      try {
        // response.created（对照 responses.js runCreateResponseStream）
        const createdEvent = {
          type: 'response.created',
          response: { ...responseObject, output: [] },
          sequence_number: 0,
        };
        await writer.write(encoder.encode(`data: ${JSON.stringify(createdEvent)}\n\n`));

        let seq = 2;
        for await (const event of streamChatToResponseEvents(
          stream as AsyncIterable<import('openai/resources/chat/completions').ChatCompletionChunk>,
          responseObject as IncompleteResponse,
          { model: this.model }
        )) {
          const ev = { ...event, sequence_number: event.sequence_number ?? seq++ };
          await writer.write(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        }

        // response.completed
        const completed = toCompletedResponse(responseObject);
        const completedEvent = {
          type: 'response.completed',
          response: completed,
          sequence_number: seq++,
        };
        await writer.write(encoder.encode(`data: ${JSON.stringify(completedEvent)}\n\n`));
        await writer.write(encoder.encode('data: [DONE]\n\n'));
      } catch (err) {
        console.error('[OpenAIChatProvider] stream error:', err);
      } finally {
        await writer.close();
      }
    })();

    return { success: true, stream: readable };
  }
}
