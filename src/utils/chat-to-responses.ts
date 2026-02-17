/**
 * Chat Completions → Responses API 转换层
 * 逻辑对照 huggingface/responses.js（input→messages、流式事件顺序、closeLastOutputItem），
 * 差异：
 * - reasoning 事件用官方 response.reasoning_text.delta / response.reasoning_text.done（与 openai 6.x 一致）
 * - reasoning 的 output item 用官方 summary: [{ type: 'summary_text', text }]，无 content.reasoning_text
 * - output_index 用 responseObject.output.length - 1（responses.js 对 message/reasoning 写死 0 会错）
 * - 不含 MCP（listMcpTools、mcp_call、mcp_approval 等）
 */

import type {
  Response as OpenAIResponse,
  ResponseOutputMessage,
  ResponseFunctionToolCall,
  ResponseOutputItem,
  ResponseReasoningItem,
} from 'openai/resources/responses/responses';
import type {
  ChatCompletionChunk,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import type { OpenAIChatRequest, OpenAIMessage, ProxyInputItem, ProxyResponse, Tool } from '../types';
import { normalizeFunctionTools } from './tool-normalizer';
import { mapToolChoiceToChat } from './tool-normalizer';

/** 官方 ResponseReasoningItem 仅含 summary，流式时内部用 _accumulated 存文本 */
export type ResponseReasoningItemLike = Omit<ResponseReasoningItem, 'summary'> & {
  summary: Array<{ type: 'summary_text'; text: string }>;
  _accumulated?: string;
};

export type ResponseOutputItemLike =
  | ResponseOutputItem
  | (ResponseOutputMessage & { content: Array<{ type: 'output_text'; text: string; annotations: unknown[] }> })
  | ResponseReasoningItemLike;

/** Chat delta 可能带 reasoning_content / reasoning（智谱等） */
export type DeltaWithReasoning = ChatCompletionChunk['choices'][0]['delta'] & {
  reasoning?: string;
  reasoning_content?: string;
};

export type IncompleteResponse = Omit<
  OpenAIResponse,
  'incomplete_details' | 'output_text' | 'parallel_tool_calls'
> & { output: ResponseOutputItemLike[] };

const SEQUENCE_NUMBER_PLACEHOLDER = -1;

/** Workers 安全 ID 生成（模仿 responses.js generateUniqueId） */
export function generateUniqueId(prefix?: string): string {
  const bytes = new Uint8Array(24);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  }
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return prefix ? `${prefix}_${hex}` : hex;
}

class StreamingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StreamingError';
  }
}

// ========== Input → Chat Completions messages（严格对照 responses.js 269-375 行）==========

/**
 * 将 Responses API 的 input + instructions 转为 Chat Completion 的 messages。
 * 仅支持 message / function_call / function_call_output，不支持 MCP。
 */
export function inputToChatMessages(request: OpenAIChatRequest): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [];

  if (request.instructions && request.instructions.trim()) {
    messages.push({ role: 'system', content: request.instructions });
  }

  const input = request.input;
  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input });
    return messages;
  }

  if (Array.isArray(input)) {
    const mapped = input
      .map((item): ChatCompletionMessageParam | undefined => {
        const rec = item as Record<string, unknown>;
        const type = rec?.type as string | undefined;

        switch (type) {
          case 'function_call':
            return {
              role: 'tool',
              content: normalizeContent(rec.arguments),
              tool_call_id: (rec.call_id ?? rec.callId ?? rec.id) as string,
            };
          case 'function_call_output':
            return {
              role: 'tool',
              content: normalizeContent(rec.output ?? rec.content),
              tool_call_id: (rec.call_id ?? rec.callId) as string,
            };
          case 'message':
          case undefined:
            if (
              rec.role === 'assistant' ||
              rec.role === 'user' ||
              rec.role === 'system' ||
              rec.role === 'developer'
            ) {
              const content = mapMessageContentToChat(rec.content);
              const role = rec.role === 'developer' ? 'system' : (rec.role as 'user' | 'assistant' | 'system');
              return { role, content } as ChatCompletionMessageParam;
            }
            return undefined;
          default:
            // MCP 等不支持，跳过
            return undefined;
        }
      })
      .filter(
        (m): m is ChatCompletionMessageParam =>
          m != null &&
          (typeof (m as { content?: unknown }).content === 'string' ||
            (Array.isArray((m as { content?: unknown }).content) &&
              ((m as { content: unknown[] }).content as unknown[]).length > 0))
      );
    messages.push(...mapped);
  }

  return messages;
}

/**
 * 当请求使用 messages 而非 input 时，将 OpenAIMessage[] 转为 Chat Completion messages。
 */
export function openaiMessagesToChatParams(
  messages: OpenAIMessage[],
  instructions?: string
): ChatCompletionMessageParam[] {
  const out: ChatCompletionMessageParam[] = [];
  if (instructions && instructions.trim()) {
    out.push({ role: 'system', content: instructions });
  }
  for (const m of messages) {
    const role = m.role === 'developer' || m.role === 'function' ? 'system' : m.role;
    if (role !== 'system' && role !== 'user' && role !== 'assistant' && role !== 'tool') continue;
    const content = m.content ?? '';
    out.push({
      role: role as 'system' | 'user' | 'assistant' | 'tool',
      content: typeof content === 'string' ? content : JSON.stringify(content),
      ...(m.name && { name: m.name }),
      ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
      ...(m.tool_calls && m.tool_calls.length > 0 && { tool_calls: m.tool_calls }),
    } as ChatCompletionMessageParam);
  }
  return out;
}

function mapMessageContentToChat(content: unknown): string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  const parts: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [];
  for (const c of content) {
    const part = c as Record<string, unknown>;
    switch (part?.type) {
      case 'input_image':
        if (typeof part.image_url === 'string') {
          parts.push({ type: 'image_url', image_url: { url: part.image_url } });
        }
        break;
      case 'output_text':
        if (part.text) {
          parts.push({ type: 'text', text: String(part.text) });
        }
        break;
      case 'refusal':
        break;
      case 'input_text':
        if (part.text != null) {
          parts.push({ type: 'text', text: String(part.text) });
        }
        break;
      default:
        break;
    }
  }
  const maybeFlat =
    parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts;
  return maybeFlat as string | typeof parts;
}

function normalizeContent(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// ========== 构建 Chat Completions 请求体（严格对照 responses.js 377-412）==========

/** 与 Responses API 对齐时 request 可能带 text / reasoning（与 responses.js req.body 一致） */
type RequestWithResponsesParams = OpenAIChatRequest & {
  text?: {
    format?: { type: string; name?: string; description?: string; schema?: Record<string, unknown>; strict?: boolean };
  };
  reasoning?: { effort?: string };
};

export function buildChatPayload(
  request: OpenAIChatRequest,
  model: string,
  messages: ChatCompletionMessageParam[]
): ChatCompletionCreateParamsStreaming {
  const tools = mapToolsToChat(request.tools);
  const tool_choice = mapToolChoice(request.tool_choice);
  const req = request as RequestWithResponsesParams;
  const max_tokens =
    req.max_output_tokens === null ? undefined : (req.max_output_tokens ?? req.max_tokens ?? undefined);
  const response_format = mapResponseFormat(req.text?.format);
  const reasoning_effort = req.reasoning?.effort as 'low' | 'medium' | 'high' | undefined;

  return {
    model,
    messages,
    stream: true,
    max_tokens,
    temperature: request.temperature,
    top_p: request.top_p,
    tools: tools?.length ? tools : undefined,
    tool_choice: tool_choice ?? 'auto',
    ...(response_format && { response_format }),
    ...(reasoning_effort && { reasoning_effort }),
  };
}

function mapResponseFormat(
  format?: { type: string; name?: string; description?: string; schema?: Record<string, unknown>; strict?: boolean }
): ChatCompletionCreateParamsStreaming['response_format'] {
  if (!format) return undefined;
  if (format.type === 'json_schema' && format.name && format.schema) {
    return {
      type: 'json_schema',
      json_schema: {
        name: format.name,
        schema: format.schema,
        description: format.description,
        strict: format.strict ?? false,
      },
    };
  }
  if (format.type === 'json_object') return { type: 'json_object' };
  return { type: 'text' };
}

function mapToolsToChat(tools?: Tool[]): ChatCompletionTool[] | undefined {
  const normalized = normalizeFunctionTools(tools ?? []);
  if (normalized.length === 0) return undefined;
  return normalized.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      strict: t.strict,
    },
  }));
}

function mapToolChoice(
  choice: OpenAIChatRequest['tool_choice']
): ChatCompletionCreateParamsStreaming['tool_choice'] {
  const c = mapToolChoiceToChat(choice);
  if (!c) return 'auto';
  return c;
}

// ========== 流式：Chat stream → Responses 事件（严格对照 handleOneTurnStream + closeLastOutputItem）==========

export interface ResponseStreamEvent {
  type: string;
  sequence_number?: number;
  [key: string]: unknown;
}

/**
 * 从 Chat Completions stream 产出 Responses API 事件序列。
 * 不执行 MCP/function_call，仅产出事件；function_call 只产出 .done 等事件。
 */
export async function* streamChatToResponseEvents(
  stream: AsyncIterable<ChatCompletionChunk>,
  responseObject: IncompleteResponse,
  options: { model: string; attachRawEvent?: (event: unknown) => unknown }
): AsyncGenerator<ResponseStreamEvent> {
  let sequenceNumber = 0;
  const push = (ev: Omit<ResponseStreamEvent, 'sequence_number'> & { type: string }): ResponseStreamEvent => ({
    ...ev,
    sequence_number: sequenceNumber++,
  });

  let previousInputTokens = responseObject.usage?.input_tokens ?? 0;
  let previousOutputTokens = responseObject.usage?.output_tokens ?? 0;
  let previousTotalTokens = responseObject.usage?.total_tokens ?? 0;
  let currentTextMode: 'text' | 'reasoning' = 'text';

  for await (const chunk of stream) {
    if (chunk.usage) {
      responseObject.usage = {
        input_tokens: previousInputTokens + (chunk.usage.prompt_tokens ?? 0),
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: previousOutputTokens + (chunk.usage.completion_tokens ?? 0),
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: previousTotalTokens + (chunk.usage.total_tokens ?? 0),
      };
    }

    if (!chunk.choices?.[0]) continue;

    const delta = chunk.choices[0].delta as DeltaWithReasoning;
    const reasoningText = delta.reasoning ?? delta.reasoning_content;

    if (delta.content || reasoningText) {
      let currentOutputItem = responseObject.output.at(-1);

      if (reasoningText) {
        if (currentTextMode === 'text') {
          for await (const e of closeLastOutputItem(responseObject, push)) {
            yield e;
          }
        }
        currentTextMode = 'reasoning';
      } else if (delta.content) {
        if (currentTextMode === 'reasoning') {
          for await (const e of closeLastOutputItem(responseObject, push)) {
            yield e;
          }
        }
        currentTextMode = 'text';
      }

      if (currentTextMode === 'text') {
        if (currentOutputItem?.type !== 'message' || (currentOutputItem as ResponseOutputMessage).status !== 'in_progress') {
          const outputObject: ResponseOutputMessage = {
            id: generateUniqueId('msg'),
            type: 'message',
            role: 'assistant',
            status: 'in_progress',
            content: [],
          };
          responseObject.output.push(outputObject);
          yield push({
            type: 'response.output_item.added',
            output_index: responseObject.output.length - 1,
            item: outputObject,
          });
        }
      } else if (currentTextMode === 'reasoning') {
        if (currentOutputItem?.type !== 'reasoning' || (currentOutputItem as ResponseReasoningItemLike).status !== 'in_progress') {
          const outputObject: ResponseReasoningItemLike = {
            id: generateUniqueId('rs'),
            type: 'reasoning',
            status: 'in_progress',
            summary: [],
            _accumulated: '',
          };
          responseObject.output.push(outputObject);
          yield push({
            type: 'response.output_item.added',
            output_index: responseObject.output.length - 1,
            item: { id: outputObject.id, type: 'reasoning', status: 'in_progress', summary: [] },
          });
        }
      }

      if (currentTextMode === 'text') {
        const currentOutputMessage = responseObject.output.at(-1) as ResponseOutputMessage;
        if (currentOutputMessage.content.length === 0) {
          const contentPart: { type: 'output_text'; text: string; annotations: unknown[] } = {
            type: 'output_text',
            text: '',
            annotations: [],
          };
          currentOutputMessage.content.push(contentPart as ResponseOutputMessage['content'][number]);
          yield push({
            type: 'response.content_part.added',
            item_id: currentOutputMessage.id,
            output_index: responseObject.output.length - 1,
            content_index: currentOutputMessage.content.length - 1,
            part: contentPart,
          });
        }
        const contentPart = currentOutputMessage.content.at(-1);
        if (!contentPart || contentPart.type !== 'output_text') {
          throw new StreamingError(
            `Not implemented: only output_text supported. Got ${(contentPart as { type?: string })?.type}`
          );
        }
        contentPart.text += delta.content ?? '';
        yield push({
          type: 'response.output_text.delta',
          item_id: currentOutputMessage.id,
          output_index: responseObject.output.length - 1,
          content_index: currentOutputMessage.content.length - 1,
          delta: delta.content ?? '',
        });
      } else if (currentTextMode === 'reasoning') {
        const currentReasoningItem = responseObject.output.at(-1) as ResponseReasoningItemLike;
        if (currentReasoningItem._accumulated === undefined) currentReasoningItem._accumulated = '';
        currentReasoningItem._accumulated += reasoningText ?? '';
        yield push({
          type: 'response.reasoning_text.delta',
          item_id: currentReasoningItem.id,
          output_index: responseObject.output.length - 1,
          content_index: 0,
          delta: reasoningText ?? '',
        });
      }
    } else if (delta.tool_calls && delta.tool_calls.length > 0) {
      const tc = delta.tool_calls[0];
      let currentOutputItem = responseObject.output.at(-1);

      if (tc.function?.name) {
        const newOutputObject: ResponseFunctionToolCall = {
          type: 'function_call',
          id: generateUniqueId('fc'),
          call_id: tc.id ?? '',
          name: tc.function.name,
          arguments: '',
        };
        responseObject.output.push(newOutputObject);
        yield push({
          type: 'response.output_item.added',
          output_index: responseObject.output.length - 1,
          item: newOutputObject,
        });
      }

      if (tc.function?.arguments) {
        currentOutputItem = responseObject.output.at(-1) as ResponseFunctionToolCall;
        currentOutputItem.arguments += tc.function.arguments;
        yield push({
          type: 'response.function_call_arguments.delta',
          item_id: currentOutputItem.id,
          output_index: responseObject.output.length - 1,
          delta: tc.function.arguments,
        });
      }
    }
  }

  for await (const e of closeLastOutputItem(responseObject, push)) {
    yield e;
  }
}

async function* closeLastOutputItem(
  responseObject: IncompleteResponse,
  push: (ev: Omit<ResponseStreamEvent, 'sequence_number'> & { type: string }) => ResponseStreamEvent
): AsyncGenerator<ResponseStreamEvent> {
  const lastOutputItem = responseObject.output.at(-1);
  if (!lastOutputItem) return;

  if (lastOutputItem.type === 'message') {
    const contentPart = (lastOutputItem as ResponseOutputMessage).content?.at(-1);
    if (contentPart?.type === 'output_text') {
      yield push({
        type: 'response.output_text.done',
        item_id: lastOutputItem.id,
        output_index: responseObject.output.length - 1,
        content_index: (lastOutputItem as ResponseOutputMessage).content.length - 1,
        text: contentPart.text,
      });
      yield push({
        type: 'response.content_part.done',
        item_id: lastOutputItem.id,
        output_index: responseObject.output.length - 1,
        content_index: (lastOutputItem as ResponseOutputMessage).content.length - 1,
        part: contentPart,
      });
    }
    (lastOutputItem as ResponseOutputMessage).status = 'completed';
    yield push({
      type: 'response.output_item.done',
      output_index: responseObject.output.length - 1,
      item: lastOutputItem,
    });
  } else if (lastOutputItem.type === 'reasoning') {
    const reasoningItem = lastOutputItem as ResponseReasoningItemLike;
    const text = reasoningItem._accumulated ?? '';
    yield push({
      type: 'response.reasoning_text.done',
      item_id: lastOutputItem.id,
      output_index: responseObject.output.length - 1,
      content_index: 0,
      text,
    });
    reasoningItem.summary = [{ type: 'summary_text', text }];
    reasoningItem.status = 'completed';
    delete reasoningItem._accumulated;
    yield push({
      type: 'response.output_item.done',
      output_index: responseObject.output.length - 1,
      item: { ...lastOutputItem, summary: reasoningItem.summary, status: 'completed' },
    });
  } else if (lastOutputItem.type === 'function_call') {
    yield push({
      type: 'response.function_call_arguments.done',
      item_id: (lastOutputItem as ResponseFunctionToolCall).id,
      output_index: responseObject.output.length - 1,
      arguments: (lastOutputItem as ResponseFunctionToolCall).arguments,
    });
    (lastOutputItem as ResponseFunctionToolCall).status = 'completed';
    yield push({
      type: 'response.output_item.done',
      output_index: responseObject.output.length - 1,
      item: lastOutputItem,
    });
  }
}

// ========== 构建初始 response 对象（对照 responses.js 94-117）==========

export function createIncompleteResponse(
  request: OpenAIChatRequest,
  model: string
): IncompleteResponse {
  return {
    created_at: Math.floor(Date.now() / 1000),
    error: null,
    id: generateUniqueId('resp'),
    instructions: request.instructions ?? null,
    max_output_tokens: request.max_output_tokens ?? request.max_tokens ?? null,
    metadata: (request as { metadata?: Record<string, unknown> }).metadata ?? {},
    model,
    object: 'response',
    output: [],
    status: 'in_progress',
    text: (request as { text?: unknown }).text ?? null,
    tool_choice: request.tool_choice ?? 'auto',
    tools: request.tools ?? [],
    temperature: request.temperature ?? 1,
    top_p: request.top_p ?? 1,
    usage: {
      input_tokens: 0,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 0,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 0,
    },
  } as IncompleteResponse;
}

/** 将 IncompleteResponse 转为最终 ProxyResponse（response.completed 用） */
export function toCompletedResponse(incomplete: IncompleteResponse): ProxyResponse {
  const output = incomplete.output as OpenAIResponse['output'];
  return {
    ...incomplete,
    status: 'completed',
    output,
    output_text: collectOutputText(output),
    incomplete_details: null,
    parallel_tool_calls: true,
  } as ProxyResponse;
}

function collectOutputText(output: OpenAIResponse['output']): string {
  for (const item of output) {
    if (item.type === 'message' && Array.isArray(item.content)) {
      const part = item.content.find((p) => (p as { type?: string }).type === 'output_text');
      if (part && typeof (part as { text?: string }).text === 'string') return (part as { text: string }).text;
    }
  }
  return '';
}
