import { Env, OpenAIChatRequest } from './types';
import { Router } from './router';
import { handleToolsRequest, handleToolsExecuteRequest } from './tools';
import { ProxyError, createErrorResponse } from './utils/error-handler';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: getCORSHeaders(request),
      });
    }

    try {
      // Verify authentication
      if (!verifyAuth(request, env)) {
        throw new ProxyError('Unauthorized', 401, 'invalid_auth');
      }

      const url = new URL(request.url);
      const path = url.pathname;

      // Health check endpoint
      if (path === '/health' || path === '/') {
        return new Response(
          JSON.stringify({
            status: 'ok',
            service: 'ai-worker-proxy',
            timestamp: new Date().toISOString(),
          }),
          {
            headers: {
              'Content-Type': 'application/json',
              ...getCORSHeaders(request),
            },
          }
        );
      }

      // Models list endpoint
      if ((path === '/models' || path === '/v1/models') && request.method === 'GET') {
        const router = new Router(env);
        const models = router.getAvailableModels();

        return new Response(
          JSON.stringify({
            object: 'list',
            data: models,
          }),
          {
            headers: {
              'Content-Type': 'application/json',
              ...getCORSHeaders(request),
            },
          }
        );
      }

      // Tools list endpoint
      if (path === '/tools' && request.method === 'GET') {
        const toolsResponse = await handleToolsRequest(request, env);
        const headers = new Headers(toolsResponse.headers);
        Object.entries(getCORSHeaders(request)).forEach(([k, v]) => headers.set(k, v));
        return new Response(toolsResponse.body, {
          status: toolsResponse.status,
          headers,
        });
      }

      // Tools execute endpoint (e.g. get_web_page, search)
      if (path === '/tools/execute' && request.method === 'POST') {
        const execResponse = await handleToolsExecuteRequest(request, env);
        const headers = new Headers(execResponse.headers);
        Object.entries(getCORSHeaders(request)).forEach(([k, v]) => headers.set(k, v));
        return new Response(execResponse.body, {
          status: execResponse.status,
          headers,
        });
      }

      // Relay endpoint: forward request to url in query (auth + host allowlist required)
      if (path === '/relay') {
        const targetUrlRaw = url.searchParams.get('url');
        if (!targetUrlRaw || targetUrlRaw.trim() === '') {
          throw new ProxyError('Invalid or missing relay target URL', 400);
        }
        let targetUrl: URL;
        try {
          targetUrl = new URL(targetUrlRaw.trim());
        } catch {
          throw new ProxyError('Invalid or missing relay target URL', 400);
        }
        if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
          throw new ProxyError('Invalid or missing relay target URL', 400);
        }
        const targetHost = targetUrl.host;
        let allowlist: string[];
        try {
          const raw = env.RELAY_ALLOWED_HOSTS ?? '[]';
          const parsed = JSON.parse(typeof raw === 'string' ? raw : '[]') as unknown;
          allowlist = Array.isArray(parsed)
            ? (parsed as string[]).map((h) => String(h).trim().toLowerCase()).filter(Boolean)
            : [];
        } catch {
          allowlist = [];
        }
        if (allowlist.length === 0 || !allowlist.includes(targetHost.toLowerCase())) {
          throw new ProxyError('Relay target host not allowed', 403);
        }
        console.log(`[Worker] Relay target: ${targetHost}`);
        const relayBody =
          request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined;
        const relayHeaders = new Headers();
        const hopByHop = new Set([
          'connection',
          'keep-alive',
          'te',
          'trailer',
          'transfer-encoding',
          'proxy-authorization',
          'proxy-authenticate',
          'proxy-connection',
        ]);
        request.headers.forEach((value, key) => {
          const lower = key.toLowerCase();
          if (hopByHop.has(lower) || lower.startsWith('proxy-')) return;
          relayHeaders.set(key, value);
        });
        relayHeaders.set('Host', targetHost);
        const relayRequest = new Request(targetUrl.toString(), {
          method: request.method,
          headers: relayHeaders,
          body: relayBody,
        });
        let upstream: Response;
        try {
          upstream = await fetch(relayRequest);
        } catch (e) {
          console.error('[Worker] Relay fetch failed:', e);
          throw new ProxyError('Relay upstream request failed', 502);
        }
        const cors = getCORSHeaders(request);
        const responseHeaders = new Headers(upstream.headers);
        Object.entries(cors).forEach(([k, v]) => responseHeaders.set(k, v));
        return new Response(upstream.body, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers: responseHeaders,
        });
      }

      // Only accept POST requests for chat completions
      if (request.method !== 'POST') {
        throw new ProxyError('Method not allowed', 405);
      }

      // Parse request body
      const body = await request.json();
      const chatRequest = body as OpenAIChatRequest;

      // Validate request
      const hasMessages =
        chatRequest.messages && Array.isArray(chatRequest.messages) && chatRequest.messages.length > 0;
      const hasInput =
        typeof chatRequest.input === 'string' ||
        (Array.isArray(chatRequest.input) && chatRequest.input.length > 0);

      if (!hasMessages && !hasInput) {
        throw new ProxyError('Invalid request: input or messages are required', 400);
      }

      if (!chatRequest.model) {
        throw new ProxyError('Invalid request: model is required', 400);
      }

      console.log(`[Worker] Processing request for model: ${chatRequest.model}`);
      console.log(`[Worker] Stream mode: ${chatRequest.stream || false}`);

      // Route request to appropriate providers based on model name
      const router = new Router(env);
      const response = await router.executeWithFallback(chatRequest);

      if (!response.success) {
        throw new ProxyError(response.error || 'All providers failed', response.statusCode || 500);
      }

      // Return streaming response
      if (response.stream) {
        return new Response(response.stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            ...getCORSHeaders(request),
          },
        });
      }

      // Return non-streaming response
      return new Response(JSON.stringify(response.response), {
        headers: {
          'Content-Type': 'application/json',
          ...getCORSHeaders(request),
        },
      });
    } catch (error) {
      console.error('[Worker] Error:', error);
      const errorResponse = createErrorResponse(error);

      // Add CORS headers to error response
      const headers = new Headers(errorResponse.headers);
      Object.entries(getCORSHeaders(request)).forEach(([key, value]) => {
        headers.set(key, value);
      });

      return new Response(errorResponse.body, {
        status: errorResponse.status,
        headers,
      });
    }
  },
};

function getCORSHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin');

  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
}

function verifyAuth(request: Request, env: Env): boolean {
  // Skip auth for health check
  const url = new URL(request.url);
  if (url.pathname === '/health' || url.pathname === '/') {
    return true;
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return false;
  }

  // Support both "Bearer <token>" and raw token
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;

  return token === env.PROXY_AUTH_TOKEN;
}
