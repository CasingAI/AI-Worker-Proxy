import { ProxyResponse, ProxyResponseOutputItem, ProxyResponseContentPart } from '../types';

export function createProxyResponse(
  content: string,
  model: string
): ProxyResponse {
  const id = `resp-${generateId()}`;
  const item: ProxyResponseOutputItem = {
    id: `item-${generateId()}`,
    type: 'message',
    status: 'completed',
    role: 'assistant',
    content: [
      {
        type: 'output_text',
        text: content,
        annotations: [],
      },
    ],
  };

  return {
    id,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    model,
    output: [item],
    output_text: content,
    status: 'completed',
    metadata: null,
  };
}

export function createProxyStreamChunk(
  text: string,
  model: string,
  status: 'in_progress' | 'completed' | 'failed' = 'in_progress',
  responseId?: string
): string {
  const chunk: ProxyResponse = {
    id: responseId ?? `resp-${generateId()}`,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    model,
    output_text: status === 'completed' ? text : '',
    status,
    usage: undefined,
    metadata: null,
    output: [
      {
        id: `item-${generateId()}`,
        type: 'message',
        status,
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text,
            annotations: [],
          },
        ],
      },
    ],
  };

  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function generateId(length: number = 29): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
