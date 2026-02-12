import { OpenAIChatRequest, OpenAIMessage, ProxyInputItem, ToolCall } from '../types';

export function normalizeMessages(request: OpenAIChatRequest): OpenAIMessage[] {
  if (request.messages && request.messages.length > 0) {
    return request.messages;
  }

  if (!request.input) {
    return [];
  }

  if (typeof request.input === 'string') {
    return [
      {
        role: 'user',
        content: request.input,
      },
    ];
  }

  const messages: OpenAIMessage[] = [];
  for (let i = 0; i < request.input.length; i += 1) {
    const normalizedMessage = normalizeInputItemToMessage(request.input[i], i);
    if (normalizedMessage) {
      messages.push(normalizedMessage);
    }
  }

  return messages;
}

export function extractInstructions(request: OpenAIChatRequest): string | undefined {
  if (request.instructions) {
    return request.instructions;
  }

  const systemMessage = request.messages?.find((msg) => msg.role === 'system');
  let firstSystemInputContent: string | undefined;
  if (request.input && typeof request.input !== 'string') {
    for (const item of request.input) {
      if (isRecord(item) && item.role === 'system') {
        firstSystemInputContent = normalizeContent(item.content);
        break;
      }
    }
  }

  if (systemMessage?.content) {
    return systemMessage.content;
  }

  if (firstSystemInputContent !== undefined) {
    return firstSystemInputContent;
  }

  return undefined;
}

export function buildResponseInput(request: OpenAIChatRequest): string | ProxyInputItem[] | undefined {
  if (request.input) {
    return request.input;
  }

  if (!request.messages || request.messages.length === 0) {
    return undefined;
  }

  return request.messages
    .filter((msg) => msg.role !== 'system')
    .map((msg) => ({
      type: 'message',
      role: msg.role === 'assistant' ? 'assistant' : msg.role,
      content: msg.content || '',
    }));
}

function normalizeInputItemToMessage(item: ProxyInputItem, index: number): OpenAIMessage | undefined {
  if (!isRecord(item)) {
    return undefined;
  }

  const type = pickString(item.type);
  if (type === 'function_call_output') {
    const toolCallId = pickString(item.call_id) ?? pickString(item.callId);
    return {
      role: 'tool',
      content: normalizeContent(item.output ?? item.content),
      tool_call_id: toolCallId,
    };
  }

  if (type === 'function_call') {
    const name = pickString(item.name);
    if (!name) {
      return undefined;
    }

    const callId =
      pickString(item.call_id) ?? pickString(item.callId) ?? pickString(item.id) ?? `call_${index}`;
    return {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: callId,
          type: 'function',
          function: {
            name,
            arguments: normalizeArguments(item.arguments),
          },
        },
      ],
    };
  }

  const role = normalizeRole(item.role);
  if (!role) {
    return undefined;
  }

  const message: OpenAIMessage = {
    role,
    content: normalizeContent(item.content),
  };

  const name = pickString(item.name);
  if (name) {
    message.name = name;
  }

  const toolCallId = pickString(item.tool_call_id);
  if (toolCallId) {
    message.tool_call_id = toolCallId;
  }

  const toolCalls = normalizeToolCalls(item.tool_calls);
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }

  return message;
}

function normalizeToolCalls(rawToolCalls: unknown): ToolCall[] {
  if (!Array.isArray(rawToolCalls)) {
    return [];
  }

  const normalized: ToolCall[] = [];
  for (let i = 0; i < rawToolCalls.length; i += 1) {
    const toolCall = rawToolCalls[i];
    if (!isRecord(toolCall)) {
      continue;
    }

    const functionRecord = isRecord(toolCall.function) ? toolCall.function : undefined;
    const functionName = pickString(functionRecord?.name);
    if (!functionName) {
      continue;
    }

    const id = pickString(toolCall.id) ?? `call_${i}`;
    normalized.push({
      id,
      type: 'function',
      function: {
        name: functionName,
        arguments: normalizeArguments(functionRecord?.arguments),
      },
    });
  }

  return normalized;
}

function normalizeRole(role: unknown): OpenAIMessage['role'] | undefined {
  if (
    role === 'system' ||
    role === 'user' ||
    role === 'assistant' ||
    role === 'tool' ||
    role === 'function' ||
    role === 'developer'
  ) {
    return role;
  }

  return undefined;
}

function normalizeContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (content === null || content === undefined) {
    return '';
  }

  if (Array.isArray(content)) {
    return content.map((part) => normalizeContentPart(part)).join('');
  }

  if (isRecord(content)) {
    if (typeof content.text === 'string') {
      return content.text;
    }
    if (typeof content.refusal === 'string') {
      return content.refusal;
    }
  }

  return safeJsonStringify(content);
}

function normalizeContentPart(part: unknown): string {
  if (typeof part === 'string') {
    return part;
  }
  if (part === null || part === undefined) {
    return '';
  }
  if (isRecord(part)) {
    if (typeof part.text === 'string') {
      return part.text;
    }
    if (typeof part.refusal === 'string') {
      return part.refusal;
    }
  }

  return safeJsonStringify(part);
}

function normalizeArguments(argumentsValue: unknown): string {
  if (typeof argumentsValue === 'string') {
    return argumentsValue;
  }

  if (argumentsValue === null || argumentsValue === undefined) {
    return '{}';
  }

  return safeJsonStringify(argumentsValue);
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}
