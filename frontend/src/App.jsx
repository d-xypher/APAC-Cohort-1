import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DAGGraph } from './components/DAGGraph';
import { AgentPanel } from './components/AgentPanel';
import { Timeline } from './components/Timeline';
import { NodeDetailsPanel } from './components/NodeDetailsPanel';
import { CommandBar } from './components/CommandBar';
import { createEventStream, dagApi } from './services/api';
import { FaMoon, FaPlay, FaSun, FaSync, FaUndoAlt } from 'react-icons/fa';

const AGENT_EVENT_LIMIT = 120;
const HIGHLIGHT_DURATION_MS = 6000;
const REFRESH_DEBOUNCE_MS = 450;
const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 15000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getInitialTheme = () => {
  if (typeof window === 'undefined') {
    return 'dark';
  }
  const storedTheme = window.localStorage.getItem('cascade-theme');
  return storedTheme === 'light' ? 'light' : 'dark';
};

const appendAgentEvent = (setEvents, event) => {
  setEvents((prev) => {
    const withTimestamp = {
      timestamp: Date.now(),
      ...event,
    };
    const next = [...prev, withTimestamp];
    if (next.length > AGENT_EVENT_LIMIT) {
      return next.slice(next.length - AGENT_EVENT_LIMIT);
    }
    return next;
  });
};

function App() {
  const [theme, setTheme] = useState(getInitialTheme);
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [agentEvents, setAgentEvents] = useState([]);
  const [cascadingNodeIds, setCascadingNodeIds] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [latestSnapshotId, setLatestSnapshotId] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isLoadingGraph, setIsLoadingGraph] = useState(false);
  const [isStreamConnected, setIsStreamConnected] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [uiError, setUiError] = useState('');
  const [uiSuccess, setUiSuccess] = useState('');

  const streamRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const clearHighlightsTimeoutRef = useRef(null);
  const refreshGraphTimeoutRef = useRef(null);
  const isFetchInFlightRef = useRef(false);
  const hasQueuedFetchRef = useRef(false);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) || null,
    [nodes, selectedNodeId],
  );

  const fetchGraph = useCallback(async () => {
    if (isFetchInFlightRef.current) {
      hasQueuedFetchRef.current = true;
      return;
    }

    isFetchInFlightRef.current = true;
    setIsLoadingGraph(true);
    try {
      do {
        hasQueuedFetchRef.current = false;
        try {
          const graph = await dagApi.getGraph();
          setNodes(graph.nodes);
          setEdges(graph.edges);
          setUiError('');
        } catch (err) {
          setUiError(err.message || 'Failed to fetch workflow graph.');
        }
      } while (hasQueuedFetchRef.current);
    } finally {
      isFetchInFlightRef.current = false;
      setIsLoadingGraph(false);
    }
  }, []);

  const scheduleGraphRefresh = useCallback(() => {
    if (refreshGraphTimeoutRef.current) {
      return;
    }

    refreshGraphTimeoutRef.current = setTimeout(() => {
      refreshGraphTimeoutRef.current = null;
      fetchGraph();
    }, REFRESH_DEBOUNCE_MS);
  }, [fetchGraph]);

  const seedData = useCallback(async () => {
    setIsSeeding(true);
    setUiError('');
    setUiSuccess('');
    try {
      await dagApi.seedDemo();
      await fetchGraph();
      setCascadingNodeIds([]);
      setSelectedNodeId(null);
      setLatestSnapshotId(null);
      setAgentEvents([]);
      setUiSuccess('Demo graph reset and seeded successfully.');
    } catch (err) {
      setUiError(err.message || 'Failed to seed demo data.');
    } finally {
      setIsSeeding(false);
    }
  }, [fetchGraph]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    window.localStorage.setItem('cascade-theme', theme);
  }, [theme]);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setCurrentTimeMs(Date.now());
    }, 1000);
    setCurrentTimeMs(Date.now());

    return () => {
      window.clearInterval(timerId);
    };
  }, []);

  useEffect(() => {
    let isDisposed = false;

    const connectStream = () => {
      if (isDisposed) {
        return;
      }

      const stream = createEventStream();
      streamRef.current = stream;

      const handleAgentUpdate = (event) => {
        try {
          const data = JSON.parse(event.data);
          appendAgentEvent(setAgentEvents, data);
          scheduleGraphRefresh();
        } catch {
          // Ignore malformed events and keep the stream alive.
        }
      };

      stream.onopen = () => {
        reconnectAttemptRef.current = 0;
        setIsStreamConnected(true);
      };

      stream.onerror = () => {
        setIsStreamConnected(false);
        stream.close();

        if (isDisposed) {
          return;
        }

        reconnectAttemptRef.current += 1;
        const delay = Math.min(
          MAX_RECONNECT_DELAY_MS,
          BASE_RECONNECT_DELAY_MS * (2 ** (reconnectAttemptRef.current - 1)),
        );

        reconnectTimeoutRef.current = setTimeout(() => {
          connectStream();
        }, delay);
      };

      stream.addEventListener('agent_update', handleAgentUpdate);

      return () => {
        stream.removeEventListener('agent_update', handleAgentUpdate);
        stream.close();
      };
    };

    fetchGraph();
    const cleanupStream = connectStream();

    return () => {
      isDisposed = true;
      setIsStreamConnected(false);

      if (cleanupStream) {
        cleanupStream();
      }

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      if (refreshGraphTimeoutRef.current) {
        clearTimeout(refreshGraphTimeoutRef.current);
      }

      if (clearHighlightsTimeoutRef.current) {
        clearTimeout(clearHighlightsTimeoutRef.current);
      }

      if (streamRef.current) {
        streamRef.current.close();
      }
    };
  }, [fetchGraph, scheduleGraphRefresh]);

  useEffect(() => {
    if (selectedNodeId && !nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [nodes, selectedNodeId]);

  const handleNodeSelect = useCallback((node) => {
    setSelectedNodeId(node?.id || null);
  }, []);

  const handleThemeToggle = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const simulateDisruption = useCallback(async () => {
    if (isSimulating || isLoadingGraph || isSeeding) {
      return;
    }

    setIsSimulating(true);
    setUiError('');
    setUiSuccess('');

    const standup = nodes.find((n) => n.title?.toLowerCase().includes('standup'));
    if (!standup || !standup.start_time) {
      setUiError('Seed demo data first so a standup node exists before simulating.');
      setIsSimulating(false);
      return;
    }

    const oldTime = new Date(standup.start_time);
    if (Number.isNaN(oldTime.getTime())) {
      setUiError('Standup node has an invalid start time.');
      setIsSimulating(false);
      return;
    }

    const newTime = new Date(oldTime.getTime() + 90 * 60000);

    try {
      appendAgentEvent(setAgentEvents, {
        agent: 'Orchestrator',
        action: 'Trigger Detected',
        message: `Standup moved to ${newTime.toLocaleTimeString()}`,
      });

      await wait(250);

      appendAgentEvent(setAgentEvents, {
        agent: 'Calendar Agent',
        action: 'Updating',
        message: 'Applying standup time change.',
      });

      const res = await dagApi.triggerCascade({
        trigger_node_id: standup.id,
        new_start_time: newTime.toISOString(),
        description: 'Standup moved via calendar UI',
      });

      const affected = Array.isArray(res?.changes)
        ? res.changes
            .map((c) => c.node_id)
            .filter((id) => typeof id === 'number')
        : [];

      appendAgentEvent(setAgentEvents, {
        agent: 'Task Agent',
        action: 'Propagating Cascade',
        message: `Adjusted ${Math.max(affected.length - 1, 0)} downstream node(s).`,
      });

      setCascadingNodeIds(affected);
      setLatestSnapshotId(res?.snapshot_id || null);
      setSelectedNodeId(standup.id);
      await fetchGraph();
      setUiSuccess(
        `Cascade applied: ${Math.max(affected.length - 1, 0)} downstream node(s) adjusted.`,
      );

      appendAgentEvent(setAgentEvents, {
        agent: 'Notes Agent',
        action: 'Logging',
        message: 'Captured cascade summary for audit trail.',
      });

      if (clearHighlightsTimeoutRef.current) {
        clearTimeout(clearHighlightsTimeoutRef.current);
      }
      clearHighlightsTimeoutRef.current = setTimeout(() => {
        setCascadingNodeIds([]);
      }, HIGHLIGHT_DURATION_MS);
    } catch (err) {
      setUiError(err.message || 'Unable to run cascade simulation.');
    } finally {
      setIsSimulating(false);
    }
  }, [fetchGraph, isLoadingGraph, isSeeding, isSimulating, nodes]);

  const undoCascade = useCallback(async () => {
    if (!latestSnapshotId || isUndoing) {
      return;
    }

    setIsUndoing(true);
    setUiError('');
    setUiSuccess('');
    try {
      await dagApi.undoCascade(latestSnapshotId);
      appendAgentEvent(setAgentEvents, {
        agent: 'Orchestrator',
        action: 'Undo Applied',
        message: `Restored snapshot ${latestSnapshotId}.`,
      });
      setLatestSnapshotId(null);
      setCascadingNodeIds([]);
      setSelectedNodeId(null);
      await fetchGraph();
      setUiSuccess('Undo complete. Workflow restored to the previous snapshot.');
    } catch (err) {
      setUiError(err.message || 'Failed to undo the latest cascade.');
    } finally {
      setIsUndoing(false);
    }
  }, [fetchGraph, isUndoing, latestSnapshotId]);

  const handleCommand = useCallback(async (query) => {
    if (isSimulating || isLoadingGraph || isSeeding || nodes.length === 0) return;

    setIsSimulating(true);
    setUiError('');
    setUiSuccess('');
    
    try {
      appendAgentEvent(setAgentEvents, {
        agent: 'Orchestrator',
        action: 'Natural Language',
        message: `Parsing query: "${query}"`,
      });

      // Simple mock: just trigger a cascade on the first available node
      const targetNode = nodes[0];
      await wait(600);

      const oldTime = new Date(targetNode.start_time);
      const newTime = new Date(Number.isNaN(oldTime.getTime()) ? Date.now() : oldTime.getTime() + 60 * 60000);

      const res = await dagApi.triggerCascade({
        trigger_node_id: targetNode.id,
        new_start_time: newTime.toISOString(),
        description: `NLP command: ${query}`,
      });

      const affected = Array.isArray(res?.changes)
        ? res.changes.map((c) => c.node_id).filter((id) => typeof id === 'number')
        : [];

      setCascadingNodeIds(affected);
      setLatestSnapshotId(res?.snapshot_id || null);
      setSelectedNodeId(targetNode.id);
      await fetchGraph();

      setUiSuccess(`AI processed command. ${Math.max(affected.length - 1, 0)} nodes adjusted.`);
    } catch (err) {
      setUiError(err.message || 'Unable to process natural language command.');
    } finally {
      setIsSimulating(false);
    }
  }, [fetchGraph, isLoadingGraph, isSeeding, isSimulating, nodes]);

  return (
    <div className="app-container">
      <header className="header glass-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <h1><span className="gradient-text-accent">⚡ CASCADE</span></h1>
          <span className={`stream-pill ${isStreamConnected ? 'connected' : 'disconnected'}`}>
            {isStreamConnected ? 'Live' : 'Reconnecting'}
          </span>
        </div>
        <CommandBar onCommand={handleCommand} />
        
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            className="btn-icon"
            onClick={handleThemeToggle}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            disabled={isLoadingGraph}
          >
            {theme === 'dark' ? <FaSun /> : <FaMoon />}
          </button>
          <button
            className="btn-icon"
            onClick={seedData}
            title={isSeeding ? 'Seeding demo data...' : 'Reset to Demo State'}
            disabled={isSeeding || isLoadingGraph || isSimulating || isUndoing}
          >
            <FaSync className={isSeeding ? 'spin' : ''} />
          </button>
          {latestSnapshotId && (
            <button
              className="btn-icon"
              onClick={undoCascade}
              style={{ color: 'var(--warning)', borderColor: 'var(--warning)' }}
              disabled={isUndoing || isSeeding || isLoadingGraph || isSimulating}
            >
              <FaUndoAlt style={{ marginRight: '8px' }} /> {isUndoing ? 'Undoing...' : 'Undo Cascade'}
            </button>
          )}
          <button
            className="btn-primary primary"
            onClick={simulateDisruption}
            disabled={isSimulating || isSeeding || isLoadingGraph || isUndoing}
            aria-busy={isSimulating}
          >
            {isSimulating ? <span className="inline-loader" aria-hidden="true" /> : <FaPlay style={{ marginRight: '8px' }} />}
            {isSimulating ? 'Cascading...' : 'Simulate Demo Disruption'}
          </button>
        </div>
      </header>

      <section className="workflow-strip glass-panel" aria-label="Orchestrator workflow summary">
        <div className="workflow-strip-header">
          <h2>Orchestrator Control Plane</h2>
          <p>Trigger -&gt; Propagation -&gt; Logging</p>
        </div>
        <div className="workflow-track">
          <span className="workflow-chip orchestrator">Orchestrator</span>
          <span className="workflow-arrow">-&gt;</span>
          <span className="workflow-chip">Calendar Agent</span>
          <span className="workflow-arrow">-&gt;</span>
          <span className="workflow-chip">Task Agent</span>
          <span className="workflow-arrow">-&gt;</span>
          <span className="workflow-chip">Notes Agent</span>
        </div>
        <div className="workflow-note">
          All schedule times in the DAG, timeline, and details panel are shown in your local timezone.
        </div>
      </section>

      {uiError && (
        <div className="error-banner" role="alert">
          {uiError}
        </div>
      )}

      {uiSuccess && (
        <div className="success-banner" role="status">
          {uiSuccess}
        </div>
      )}

      <main className="main-content">
        <div className="sidebar">
          <AgentPanel
            events={agentEvents}
            isStreamConnected={isStreamConnected}
            nowMs={currentTimeMs}
          />
        </div>
        
        <div className="graph-section glass-panel">
          <div className="graph-header-overlay">
            <h2 style={{ fontSize: '1.2rem' }}>Workflow Dependency Graph (DAG)</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Watch the physics of your day (local time)
            </p>
          </div>
          <DAGGraph
            nodesData={nodes}
            edgesData={edges}
            cascadingNodeIds={cascadingNodeIds}
            selectedNodeId={selectedNodeId}
            onNodeSelect={handleNodeSelect}
            isLoading={isLoadingGraph}
          />
        </div>
        
        <div className="sidebar">
          <Timeline
            nodes={nodes}
            selectedNodeId={selectedNodeId}
            onNodeSelect={handleNodeSelect}
            cascadingNodeIds={cascadingNodeIds}
            isLoading={isLoadingGraph}
          />
          <NodeDetailsPanel node={selectedNode} />
        </div>
      </main>
    </div>
  );
}

export default App;
