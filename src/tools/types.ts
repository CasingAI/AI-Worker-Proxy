/**
 * Types for the /tools endpoint (list and future tool-related payloads).
 */

export interface ToolListItem {
  id: string;
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ToolsListResponse {
  object: 'list';
  data: ToolListItem[];
}
