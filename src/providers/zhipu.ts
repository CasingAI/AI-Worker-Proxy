import OpenAI from 'openai';
import { BaseProvider } from './base';
import {
  OpenAIChatRequest,
  OpenAIMessage,
  ProviderResponse,
  ProxyResponseOutputItem,
  ProxyResponseUsage,
  ReasoningEffort,
  Tool,
} from '../types';
import {
  createProxyResponse,
  createProxyStreamChunk,
  createReasoningDeltaChunk,
  createReasoningDoneChunk,
  createResponseStartedChunk,
  createStreamIds,
} from '../utils/response-mapper';
import { normalizeMessages } from '../utils/request';
import { mapToolChoiceToChat, normalizeFunctionTools } from '../utils/tool-normalizer';

const DEFAULT_BASE_URL = 'https://api.z.ai/api/paas/v4/';
// const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4/';

const HIGH_REASONING_REMINDER = `你当前处于长思考模式，请使用你的最大推理能力+使用最多token进行reasoning。
你拥有以下思维习惯的最强大脑：
- 系统性思维：总是先分析关系，理清因果关系
- 反共识倾向：主动寻找主流观点的漏洞和反例
- 第一性原理：不断追问"这个问题的本质是什么"
请在回答末尾列出主要推理步骤，并逐一标注显著的不确定点或假设。`;

const XHIGH_REASONING_REMINDER = `${HIGH_REASONING_REMINDER}
在此基础上请再加倍强化：
- 用编号列出至少三个关键推理步骤，每步后追加一句"我对这一步的不确定点是：..."；
- 补充可能的反例、替代解释或风险预估，提示哪些地方需要进一步验证；
- 最后以"结论与建议"总结，并给出当前信心水平（如高/中/低）。`;

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

  async chat(
    request: OpenAIChatRequest,
    apiKey: string,
    reasoningEffort?: ReasoningEffort
  ): Promise<ProviderResponse> {
    try {
      const client = new OpenAI({
        apiKey,
        baseURL: this.endpoint,
      });

      const effort = reasoningEffort ?? 'low';
      const messages = this.buildMessages(request, effort);
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
        let fullReasoningText = '';
        let lastRawEvent: unknown;
        const functionCallStates = new Map<number, FunctionCallState>();
        let nextFunctionOutputIndex = 1;
        let hasEmittedReasoning = false;
        let reasoningDoneEmitted = false;
        for await (const chunk of stream) {
          lastRawEvent = chunk;
          let emittedForChunk = false;
          const delta = chunk.choices?.[0]?.delta;
          const { reasoning: reasoningDelta, outputText: outputTextDelta } =
            extractReasoningAndOutput(delta);
          const chunkUsage = (chunk as { usage?: ProxyResponseUsage }).usage;
          if (chunkUsage) {
            lastUsage = chunkUsage;
          }
          const toolCallDeltas = parseToolCallDeltas(chunk.choices?.[0]?.delta?.tool_calls);

          // 思考内容 → response.reasoning_summary_part.delta（与 OpenAI Responses API 对齐，并累积供最终 summary + usage.reasoning_tokens）
          if (reasoningDelta) {
            emittedForChunk = true;
            hasEmittedReasoning = true;
            fullReasoningText += reasoningDelta;
            const reasoningChunk = createReasoningDeltaChunk(reasoningDelta, {
              itemId,
              rawEvent: chunk,
            });
            await writer.write(encoder.encode(reasoningChunk));
          }
          // 正式输出 → response.output_text.delta（若此前有过 reasoning，先发 reasoning_summary_part.done）
          if (outputTextDelta) {
            if (hasEmittedReasoning && !reasoningDoneEmitted) {
              reasoningDoneEmitted = true;
              const reasoningDoneChunk = createReasoningDoneChunk({
                itemId,
                rawEvent: chunk,
              });
              await writer.write(encoder.encode(reasoningDoneChunk));
            }
            fullText += outputTextDelta;
            emittedForChunk = true;
            const chunkData = createProxyStreamChunk(outputTextDelta, this.model, 'in_progress', {
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

        // 与 OpenAI Responses API 对齐：usage 含 output_tokens_details.reasoning_tokens；若有 reasoning 则写入 response.output[0].content
        const hasReasoning = fullReasoningText.length > 0;
        const reasoningTokens =
          lastUsage?.output_tokens_details?.reasoning_tokens ??
          (hasReasoning ? Math.max(1, Math.ceil(fullReasoningText.length / 4)) : undefined);
        const finalUsage: ProxyResponseUsage | undefined =
          lastUsage != null
            ? reasoningTokens != null
              ? {
                  ...lastUsage,
                  output_tokens_details: {
                    ...lastUsage.output_tokens_details,
                    reasoning_tokens: reasoningTokens,
                  },
                }
              : lastUsage
            : reasoningTokens != null
              ? {
                  input_tokens: 0,
                  output_tokens: 0,
                  total_tokens: 0,
                  input_tokens_details: { cached_tokens: 0 },
                  output_tokens_details: { reasoning_tokens: reasoningTokens },
                }
              : undefined;

        const finishChunk = createProxyStreamChunk('', this.model, 'completed', {
          responseId,
          itemId,
          outputText: fullText,
          rawEvent: lastRawEvent,
          additionalOutputItems,
          usage: finalUsage,
          reasoningSummary: hasReasoning ? fullReasoningText : undefined,
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

  private buildMessages(
    request: OpenAIChatRequest,
    reasoningEffort: ReasoningEffort
  ): OpenAI.ChatCompletionMessageParam[] {
    const normalized = [...normalizeMessages(request)];
    const instructions = request.instructions?.trim();
    const hasSystemOrDeveloper = normalized.some(
      (message) => message.role === 'system' || message.role === 'developer'
    );

    if (instructions && !hasSystemOrDeveloper) {
      normalized.unshift({
        role: 'system',
        content: instructions,
      });
    }

    const reasoningMessage = this.buildReasoningMessage(reasoningEffort);
    if (reasoningMessage) {
      normalized.push(reasoningMessage);
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

  private buildReasoningMessage(
    effort: ReasoningEffort
  ): OpenAIMessage | undefined {
    if (effort === 'low' || effort === 'medium') {
      return undefined;
    }

    const reminder =
      effort === 'xhigh'
        ? XHIGH_REASONING_REMINDER
        : effort === 'high'
        ? HIGH_REASONING_REMINDER
        : undefined;

    if (!reminder) {
      return undefined;
    }

    return {
      role: 'system',
      content: `<system-reminder>${reminder}</system-reminder>`,
    };
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

/** 从 delta 中分别取出 reasoning（思考）与 outputText（正式输出），便于发不同事件类型 */
function extractReasoningAndOutput(delta: unknown): { reasoning?: string; outputText?: string } {
  if (typeof delta === 'string') {
    return { outputText: delta };
  }
  if (!isRecord(delta)) {
    return {};
  }
  const out = getReasoningAndOutputFromRecord(delta);
  if (out.reasoning || out.outputText) return out;
  const nested = isRecord(delta.message) ? delta.message : undefined;
  if (nested) return getReasoningAndOutputFromRecord(nested);
  return {};
}

function getReasoningAndOutputFromRecord(
  record: Record<string, unknown>
): { reasoning?: string; outputText?: string } {
  const reasoning =
    typeof record.reasoning_content === 'string' && record.reasoning_content.length > 0
      ? record.reasoning_content
      : undefined;
  const outputText =
    (typeof record.content === 'string' && record.content.length > 0 ? record.content : undefined) ??
    (typeof record.text === 'string' && record.text.length > 0 ? record.text : undefined);
  return { reasoning, outputText };
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
