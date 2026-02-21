import type { Env } from '../types';
import type { ToolsListResponse } from './types';
import { JINA_TOOLS } from './definitions';
import { jinaReader, jinaSearch } from './jina';

/**
 * Handles GET /tools.
 * Returns a list of tools available via this proxy (includes Jina read/search).
 */
export async function handleToolsRequest(_request: Request, _env: Env): Promise<Response> {
  const body: ToolsListResponse = {
    object: 'list',
    data: [...JINA_TOOLS],
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

export interface ToolsExecuteRequest {
  tool: 'get_web_page' | 'search';
  arguments: Record<string, unknown>;
}

/**
 * Handles POST /tools/execute.
 * Runs the given tool with arguments (e.g. get_web_page with url, search with q).
 */
export async function handleToolsExecuteRequest(request: Request, env: Env): Promise<Response> {
  let body: ToolsExecuteRequest;
  try {
    body = (await request.json()) as ToolsExecuteRequest;
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body', code: 'invalid_request' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
  const { tool, arguments: args } = body;
  if (!tool || typeof args !== 'object' || args === null) {
    return new Response(
      JSON.stringify({ error: 'Missing tool or arguments', code: 'invalid_request' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (tool === 'get_web_page') {
    const url = typeof args.url === 'string' ? args.url : undefined;
    if (!url) {
      return new Response(
        JSON.stringify({ error: 'get_web_page requires arguments.url', code: 'invalid_request' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const result = await jinaReader(env, { url });
    if (!result.success) {
      return new Response(
        JSON.stringify({ error: result.error, code: 'tool_error' }),
        { status: result.statusCode ?? 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify(result.data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (tool === 'search') {
    const q = typeof args.q === 'string' ? args.q : undefined;
    if (!q) {
      return new Response(
        JSON.stringify({ error: 'search requires arguments.q', code: 'invalid_request' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const result = await jinaSearch(env, {
      q,
      // gl: typeof args.gl === 'string' ? args.gl : undefined,
      // hl: typeof args.hl === 'string' ? args.hl : undefined,
      // num: typeof args.num === 'number' ? args.num : undefined,
      // page: typeof args.page === 'number' ? args.page : undefined,
    });
    if (!result.success) {
      return new Response(
        JSON.stringify({ error: result.error, code: 'tool_error' }),
        { status: result.statusCode ?? 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify(result.data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({ error: `Unknown tool: ${tool}`, code: 'invalid_request' }),
    { status: 400, headers: { 'Content-Type': 'application/json' } }
  );
}
