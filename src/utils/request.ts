import { OpenAIChatRequest, OpenAIMessage, ProxyInputItem } from '../types';

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

  return request.input.map((item) => ({
    role: item.role === 'assistant' ? 'assistant' : item.role,
    content: item.content,
  }));
}

export function extractInstructions(request: OpenAIChatRequest): string | undefined {
  if (request.instructions) {
    return request.instructions;
  }

  const systemMessage = request.messages?.find((msg) => msg.role === 'system');
  const firstSystemInput = request.input && typeof request.input !== 'string'
    ? request.input.find((item) => item.role === 'system')
    : undefined;

  if (systemMessage?.content) {
    return systemMessage.content;
  }

  if (firstSystemInput) {
    return firstSystemInput.content;
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
