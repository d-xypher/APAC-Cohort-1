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

export const createEventStream = () => {
  const streamUrl = import.meta.env.VITE_EVENTS_STREAM_URL || `${API_BASE_URL}/events/stream`;
  return new EventSource(streamUrl);
};
