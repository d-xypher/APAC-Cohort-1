import axios from 'axios';

const rawApiBase = import.meta.env.VITE_API_BASE_URL || '/api';
const trimmedApiBase = rawApiBase.replace(/\/+$/, '');
const timeoutMs = Number(import.meta.env.VITE_API_TIMEOUT_MS || 15000);

export const API_BASE_URL = trimmedApiBase;

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: timeoutMs,
  headers: {
    'Content-Type': 'application/json',
  },
});

const getErrorMessage = (error, fallbackMessage) => {
  if (error?.response?.data?.detail) {
    return String(error.response.data.detail);
  }
  if (error?.code === 'ECONNABORTED') {
    return 'Request timed out. Please try again.';
  }
  if (error?.message === 'Network Error') {
    return 'Unable to reach the backend service. Confirm the backend is running.';
  }
  if (error?.message) {
    return error.message;
  }
  return fallbackMessage;
};

const request = async ({ method, url, data, fallbackMessage }) => {
  try {
    const response = await apiClient({ method, url, data });
    return response.data;
  } catch (error) {
    throw new Error(getErrorMessage(error, fallbackMessage));
  }
};

const normalizeCascadePayload = (payload) => {
  const triggerNodeIdRaw = payload?.trigger_node_id ?? payload?.triggerNodeId ?? payload?.node_id;
  const triggerNodeId = Number(triggerNodeIdRaw);
  if (!Number.isFinite(triggerNodeId)) {
    throw new Error('Cannot trigger cascade: trigger_node_id is missing or invalid.');
  }

  const startCandidate = payload?.new_start_time ?? payload?.newStartTime;
  const startDate = startCandidate ? new Date(startCandidate) : null;
  if (!startDate || Number.isNaN(startDate.getTime())) {
    throw new Error('Cannot trigger cascade: new_start_time must be a valid ISO datetime.');
  }

  const descriptionRaw = typeof payload?.description === 'string' ? payload.description.trim() : '';
  const description = descriptionRaw || 'Demo disruption';

  return {
    trigger_node_id: triggerNodeId,
    new_start_time: startDate.toISOString(),
    description,
  };
};

export const dagApi = {
  async getGraph() {
    const [nodes, edges] = await Promise.all([
      request({
        method: 'get',
        url: '/dag/nodes',
        fallbackMessage: 'Failed to load DAG nodes.',
      }),
      request({
        method: 'get',
        url: '/dag/edges',
        fallbackMessage: 'Failed to load DAG edges.',
      }),
    ]);

    return {
      nodes: Array.isArray(nodes) ? nodes : [],
      edges: Array.isArray(edges) ? edges : [],
    };
  },

  async getNode(nodeId) {
    return request({
      method: 'get',
      url: `/dag/nodes/${nodeId}`,
      fallbackMessage: 'Failed to load node.',
    });
  },

  async createNode(nodeData) {
    return request({
      method: 'post',
      url: '/dag/nodes',
      data: nodeData,
      fallbackMessage: 'Failed to create node.',
    });
  },

  async updateNode(nodeId, nodeData) {
    return request({
      method: 'put',
      url: `/dag/nodes/${nodeId}`,
      data: nodeData,
      fallbackMessage: 'Failed to update node.',
    });
  },

  async deleteNode(nodeId) {
    return request({
      method: 'delete',
      url: `/dag/nodes/${nodeId}`,
      fallbackMessage: 'Failed to delete node.',
    });
  },

  async createEdge(edgeData) {
    return request({
      method: 'post',
      url: '/dag/edges',
      data: edgeData,
      fallbackMessage: 'Failed to create edge.',
    });
  },

  async deleteEdge(edgeId) {
    return request({
      method: 'delete',
      url: `/dag/edges/${edgeId}`,
      fallbackMessage: 'Failed to delete edge.',
    });
  },

  async previewCascade(nodeId, newStartTime) {
    return request({
      method: 'post',
      url: '/dag/cascade/preview',
      data: {
        node_id: nodeId,
        new_start_time: new Date(newStartTime).toISOString(),
      },
      fallbackMessage: 'Failed to preview cascade.',
    });
  },

  async getResolutionOptions(nodeId, conflicts = []) {
    return request({
      method: 'post',
      url: '/cascade/resolution-options',
      data: {
        node_id: Number(nodeId),
        conflicts: Array.isArray(conflicts) ? conflicts : [],
      },
      fallbackMessage: 'Failed to generate conflict resolution options.',
    });
  },

  async seedDemo() {
    return request({
      method: 'post',
      url: '/seed/',
      fallbackMessage: 'Failed to seed demo data.',
    });
  },

  async triggerCascade(payload) {
    const normalizedPayload = normalizeCascadePayload(payload);
    return request({
      method: 'post',
      url: '/cascade/trigger',
      data: normalizedPayload,
      fallbackMessage: 'Failed to trigger cascade.',
    });
  },

  async undoCascade(snapshotId) {
    return request({
      method: 'post',
      url: `/cascade/undo/${snapshotId}`,
      fallbackMessage: 'Failed to undo cascade.',
    });
  },
};

/**
 * Chat API for conversational AI with Gemini
 */
export const chatApi = {
  /**
   * Send a chat message (non-streaming).
   * @param {string} message - The user's message
   * @param {string} [context] - Optional context (e.g., current time, selected node info)
   * @returns {Promise<{response: string, tool_calls: Array, tool_results: Array}>}
   */
  async sendMessage(message, context = null) {
    return request({
      method: 'post',
      url: '/chat/',
      data: { message, context },
      fallbackMessage: 'Failed to get AI response.',
    });
  },

  /**
   * Create a streaming chat connection using SSE.
   * @param {string} message - The user's message
   * @param {string} [context] - Optional context
   * @param {object} callbacks - Event callbacks
   * @param {function} callbacks.onText - Called with text chunks
   * @param {function} callbacks.onToolCall - Called when a tool is invoked
   * @param {function} callbacks.onToolResult - Called with tool results
   * @param {function} callbacks.onDone - Called when streaming completes
   * @param {function} callbacks.onError - Called on error
   * @returns {Promise<void>}
   */
  async streamMessage(message, context, callbacks) {
    const { onText, onToolCall, onToolResult, onDone, onError } = callbacks;
    
    try {
      const response = await fetch(`${API_BASE_URL}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message, context }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              switch (data.type) {
                case 'text':
                  onText?.(data.content);
                  break;
                case 'tool_call':
                  onToolCall?.(data.name, data.args);
                  break;
                case 'tool_result':
                  onToolResult?.(data.name, data.result);
                  break;
                case 'done':
                  onDone?.(data.tool_calls, data.tool_results);
                  break;
                case 'error':
                  onError?.(new Error(data.message));
                  break;
              }
            } catch {
              // Ignore malformed JSON
            }
          }
        }
      }
    } catch (error) {
      onError?.(error);
      throw error;
    }
  },
};

export const createEventStream = () => {
  const streamUrl = import.meta.env.VITE_EVENTS_STREAM_URL || `${API_BASE_URL}/events/stream`;
  return new EventSource(streamUrl);
};
