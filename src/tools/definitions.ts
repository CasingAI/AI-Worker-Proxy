import type { ToolListItem } from './types';

export const JINA_TOOLS: ToolListItem[] = [
  {
    id: 'get_web_page',
    type: 'function',
    function: {
      name: 'get_web_page',
      description: 'Read and extract main content from a single URL in LLM-friendly format (Jina Reader). Use when you already know the page URL.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The full URL of the web page to read (e.g. https://example.com/article)',
          },
        },
        required: ['url'],
      },
    },
  },
  {
    id: 'search',
    type: 'function',
    function: {
      name: 'search',
      description: 'Search the web and get LLM-friendly content from search results (Jina Search). Use when you need to find information but do not have a specific URL.',
      parameters: {
        type: 'object',
        properties: {
          q: {
            type: 'string',
            description: 'Search query',
          },
          gl: { type: 'string', description: 'Two-letter country code for search locale' },
          hl: { type: 'string', description: 'Two-letter language code' },
          num: { type: 'number', description: 'Maximum number of results' },
          page: { type: 'number', description: 'Result offset for pagination' },
        },
        required: ['q'],
      },
    },
  },
];
