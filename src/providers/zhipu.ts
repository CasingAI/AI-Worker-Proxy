import OpenAI from 'openai';
import { BaseProvider } from './base';
import {
  OpenAIChatRequest,
  ProviderResponse,
  ProxyResponseOutputItem,
  ProxyResponseUsage,
  Tool,
} from '../types';
import { createProxyResponse, createProxyStreamChunk, createResponseStartedChunk, createStreamIds } from '../utils/response-mapper';
import { normalizeMessages } from '../utils/request';
import { mapToolChoiceToChat, normalizeFunctionTools } from '../utils/tool-normalizer';

const DEFAULT_BASE_URL = 'https://api.z.ai/api/paas/v4/';
// const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4/';

interface ParsedToolCallDelta {
  index: number;
  id?: string;
  name?: string;
  argumentsDelta?: string;
}

interface FunctionCallState {
  outputIndex: number;
  itemId: string;
  callId: string;
  name: string;
  arguments: string;
  added: boolean;
}

export class ZhipuProvider extends BaseProvider {
  constructor(model: string, endpoint?: string) {
    super(model, endpoint ?? DEFAULT_BASE_URL);
  }

  async chat(request: OpenAIChatRequest, apiKey: string): Promise<ProviderResponse> {
    try {
      const client = new OpenAI({
        apiKey,
        baseURL: this.endpoint,
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
    const message = response.choices?.[0]?.message;
    const content = this.extractAssistantMessage(message);
    const usage = response.usage as ProxyResponseUsage | undefined;
    const proxyResponse = createProxyResponse(content, this.model, {
      ...(usage ? { usage } : {}),
    });
    const toolCalls = message?.tool_calls ?? [];

    if (!content && toolCalls.length > 0) {
      proxyResponse.output = [];
    }
    proxyResponse.output.push(...this.mapToolCallItems(toolCalls, 'completed'));

    return {
      success: true,
      response: proxyResponse,
    };
  }

  private async handleStream(
    client: OpenAI,
    params: OpenAI.ChatCompletionCreateParamsStreaming
  ): Promise<ProviderResponse> {
    const stream = await client.chat.completions.create(params);
    const { responseId, itemId } = createStreamIds();

    let lastUsage: ProxyResponseUsage | undefined;
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    (async () => {
      try {
        await writer.write(encoder.encode(createResponseStartedChunk(responseId, itemId, this.model)));
 
        let fullText = '';
        let lastRawEvent: unknown;
        const functionCallStates = new Map<number, FunctionCallState>();
        let nextFunctionOutputIndex = 1;
        for await (const chunk of stream) {
          lastRawEvent = chunk;
          let emittedForChunk = false;
          const delta = chunk.choices?.[0]?.delta;
          const deltaText = extractChoiceDeltaText(delta);
          const chunkUsage = (chunk as { usage?: ProxyResponseUsage }).usage;
          if (chunkUsage) {
            lastUsage = chunkUsage;
          }
          const toolCallDeltas = parseToolCallDeltas(chunk.choices?.[0]?.delta?.tool_calls);

          if (deltaText) {
            fullText += deltaText;
            emittedForChunk = true;
            const chunkData = createProxyStreamChunk(deltaText, this.model, 'in_progress', {
              responseId,
              itemId,
              rawEvent: chunk,
            });
            await writer.write(encoder.encode(chunkData));
          }

          for (const toolCallDelta of toolCallDeltas) {
            const state = this.getOrCreateFunctionCallState(
              functionCallStates,
              toolCallDelta.index,
              () => nextFunctionOutputIndex++
            );
            const events = this.buildFunctionCallDeltaEvents(state, toolCallDelta);
            for (const event of events) {
              await writer.write(encoder.encode(this.serializeSseEvent(event, chunk)));
              emittedForChunk = true;
            }
          }

          // 即使上游 chunk 没有文本和工具增量，也输出一个事件与之对应。
          if (!emittedForChunk) {
            const passthroughChunk = createProxyStreamChunk('', this.model, 'in_progress', {
              responseId,
              itemId,
              rawEvent: chunk,
            });
            await writer.write(encoder.encode(passthroughChunk));
          }
        }

        const additionalOutputItems: ProxyResponseOutputItem[] = [];
        const orderedStates = [...functionCallStates.values()].sort(
          (left, right) => left.outputIndex - right.outputIndex
        );
        for (const state of orderedStates) {
          const completedItem = this.toFunctionCallOutputItem(state, 'completed');
          additionalOutputItems.push(completedItem);

          const argumentsDoneEvent = {
            type: 'response.function_call_arguments.done',
            item_id: state.itemId,
            output_index: state.outputIndex,
            arguments: state.arguments,
          };
          await writer.write(encoder.encode(this.serializeSseEvent(argumentsDoneEvent, lastRawEvent)));

          const outputDoneEvent = {
            type: 'response.output_item.done',
            output_index: state.outputIndex,
            item: completedItem,
          };
          await writer.write(encoder.encode(this.serializeSseEvent(outputDoneEvent, lastRawEvent)));
        }

        const finishChunk = createProxyStreamChunk('', this.model, 'completed', {
          responseId,
          itemId,
          outputText: fullText,
          rawEvent: lastRawEvent,
          additionalOutputItems,
          usage: lastUsage,
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

    const chatMessages: OpenAI.ChatCompletionMessageParam[] = [];
    for (const message of normalized) {
      const role = mapMessageRoleForChat(message.role);
      if (!role) {
        continue;
      }

      if (role === 'tool' && !message.tool_call_id) {
        continue;
      }

      const toolCalls =
        role === 'assistant'
          ? message.tool_calls
              ?.map((toolCall) => {
                const functionName = toolCall.function?.name;
                if (!functionName) {
                  return undefined;
                }

                return {
                  id: toolCall.id,
                  type: toolCall.type,
                  function: {
                    name: functionName,
                    arguments: toolCall.function.arguments ?? '{}',
                  },
                };
              })
              .filter(
                (toolCall): toolCall is OpenAI.ChatCompletionMessageToolCall => Boolean(toolCall)
              )
          : undefined;

      chatMessages.push({
        role,
        content: message.content ?? '',
        name: message.name,
        tool_calls: toolCalls,
        tool_call_id: message.tool_call_id,
      } as OpenAI.ChatCompletionMessageParam);
    }

    return chatMessages;
  }

  private extractAssistantMessage(message?: OpenAI.ChatCompletionMessage): string {
    if (!message) {
      return '';
    }

    if (typeof message.content === 'string') {
      return message.content;
    }

    if (isRecord(message)) {
      const reasoningContent = message.reasoning_content;
      if (typeof reasoningContent === 'string') {
        return reasoningContent;
      }
    }

    return '';
  }

  private mapToolCallItems(
    toolCalls: OpenAI.ChatCompletionMessageToolCall[],
    status: 'in_progress' | 'completed'
  ): ProxyResponseOutputItem[] {
    const items: ProxyResponseOutputItem[] = [];

    for (const toolCall of toolCalls) {
      const name = toolCall.function?.name?.trim();
      if (!name) {
        continue;
      }

      const callId = toolCall.id ?? `call-${createShortId()}`;
      items.push({
        id: `item-${createShortId()}`,
        type: 'function_call',
        status,
        call_id: callId,
        name,
        arguments: toolCall.function.arguments ?? '',
      });
    }

    return items;
  }

  private getOrCreateFunctionCallState(
    states: Map<number, FunctionCallState>,
    index: number,
    nextOutputIndex: () => number
  ): FunctionCallState {
    const existing = states.get(index);
    if (existing) {
      return existing;
    }

    const state: FunctionCallState = {
      outputIndex: nextOutputIndex(),
      itemId: `item-${createShortId()}`,
      callId: `call-${createShortId()}`,
      name: '',
      arguments: '',
      added: false,
    };
    states.set(index, state);
    return state;
  }

  private buildFunctionCallDeltaEvents(
    state: FunctionCallState,
    delta: ParsedToolCallDelta
  ): Record<string, unknown>[] {
    if (delta.id) {
      state.callId = delta.id;
    }
    if (delta.name) {
      state.name = delta.name;
    }

    const events: Record<string, unknown>[] = [];
    if (!state.added) {
      events.push({
        type: 'response.output_item.added',
        output_index: state.outputIndex,
        item: this.toFunctionCallOutputItem(state, 'in_progress'),
      });
      state.added = true;
    }

    if (typeof delta.argumentsDelta === 'string') {
      state.arguments += delta.argumentsDelta;
      if (delta.argumentsDelta.length > 0) {
        events.push({
          type: 'response.function_call_arguments.delta',
          item_id: state.itemId,
          output_index: state.outputIndex,
          delta: delta.argumentsDelta,
        });
      }
    }

    return events;
  }

  private toFunctionCallOutputItem(
    state: FunctionCallState,
    status: 'in_progress' | 'completed'
  ): ProxyResponseOutputItem {
    const name = state.name || 'unknown_function';
    return {
      id: state.itemId,
      type: 'function_call',
      status,
      call_id: state.callId,
      name,
      arguments: state.arguments,
    };
  }

  private serializeSseEvent(event: Record<string, unknown>, rawEvent?: unknown): string {
    const payload =
      rawEvent === undefined
        ? event
        : {
            ...event,
            __provider_raw_event: rawEvent,
          };
    return `data: ${JSON.stringify(payload)}\n\n`;
  }
}

function mapToolsToChatTools(tools?: Tool[]): OpenAI.ChatCompletionTool[] | undefined {
  const normalizedTools = normalizeFunctionTools(tools);
  if (normalizedTools.length === 0) {
    return undefined;
  }

  return normalizedTools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function mapToolChoice(
  choice?: OpenAIChatRequest['tool_choice']
): OpenAI.ChatCompletionToolChoiceOption | undefined {
  return mapToolChoiceToChat(choice) as OpenAI.ChatCompletionToolChoiceOption | undefined;
}

function mapMessageRoleForChat(
  role: string
): 'system' | 'user' | 'assistant' | 'tool' | undefined {
  if (role === 'developer') {
    return 'system';
  }
  if (role === 'function') {
    return 'tool';
  }
  if (role === 'system' || role === 'user' || role === 'assistant' || role === 'tool') {
    return role;
  }
  return undefined;
}

function extractChoiceDeltaText(delta: unknown): string {
  if (typeof delta === 'string') {
    return delta;
  }

  if (!isRecord(delta)) {
    return '';
  }

  const directText = extractTextFromRecord(delta);
  if (directText) {
    return directText;
  }

  const nestedMessage = isRecord(delta.message) ? delta.message : undefined;
  if (nestedMessage) {
    return extractTextFromRecord(nestedMessage);
  }

  return '';
}

function extractTextFromRecord(record: Record<string, unknown>): string {
  const textFields = ['content', 'reasoning_content', 'text'];
  for (const field of textFields) {
    const value = record[field];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return '';
}

function parseToolCallDeltas(toolCalls: unknown): ParsedToolCallDelta[] {
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  const parsed: ParsedToolCallDelta[] = [];
  for (let i = 0; i < toolCalls.length; i += 1) {
    const toolCall = toolCalls[i];
    if (!isRecord(toolCall)) {
      continue;
    }

    const functionRecord = isRecord(toolCall.function) ? toolCall.function : undefined;
    parsed.push({
      index: typeof toolCall.index === 'number' ? toolCall.index : i,
      id: typeof toolCall.id === 'string' ? toolCall.id : undefined,
      name: typeof functionRecord?.name === 'string' ? functionRecord.name : undefined,
      argumentsDelta:
        typeof functionRecord?.arguments === 'string' ? functionRecord.arguments : undefined,
    });
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createShortId(): string {
  return Math.random().toString(36).slice(2, 12);
}
