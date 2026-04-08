import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DAGGraph } from './components/DAGGraph';
import { AgentPanel } from './components/AgentPanel';
import { Timeline } from './components/Timeline';
import { NodeDetailsPanel } from './components/NodeDetailsPanel';
import { CommandBar } from './components/CommandBar';
import { NodeModal } from './components/NodeModal';
import { CascadePreviewModal } from './components/CascadePreviewModal';
import { ConflictResolutionModal } from './components/ConflictResolutionModal';
import { CommandPalette } from './components/CommandPalette';
import { OnboardingModal } from './components/OnboardingModal';
import { createEventStream, dagApi, chatApi } from './services/api';
import { FaMoon, FaPlus, FaSun, FaSync, FaUndoAlt, FaKeyboard } from 'react-icons/fa';

const AGENT_EVENT_LIMIT = 120;
const HIGHLIGHT_DURATION_MS = 6000;
const REFRESH_DEBOUNCE_MS = 450;
const BASE_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 15000;
const ONBOARDING_KEY = 'cascade-onboarding-complete';

const getInitialTheme = () => {
  if (typeof window === 'undefined') {
    return 'dark';
  }
  const storedTheme = window.localStorage.getItem('cascade-theme');
  return storedTheme === 'light' ? 'light' : 'dark';
};

const hasCompletedOnboarding = () => {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(ONBOARDING_KEY) === 'true';
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
  const [isUndoing, setIsUndoing] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isLoadingGraph, setIsLoadingGraph] = useState(false);
  const [isStreamConnected, setIsStreamConnected] = useState(false);
  const [isChatting, setIsChatting] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [uiError, setUiError] = useState('');
  const [uiSuccess, setUiSuccess] = useState('');
  
  // Modal states
  const [showNodeModal, setShowNodeModal] = useState(false);
  const [editingNode, setEditingNode] = useState(null);
  const [showCascadePreview, setShowCascadePreview] = useState(false);
  const [cascadePreviewData, setCascadePreviewData] = useState(null);
  const [pendingCascade, setPendingCascade] = useState(null);
  const [showConflictResolution, setShowConflictResolution] = useState(false);
  const [conflictData, setConflictData] = useState({ conflicts: [], options: [] });
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(!hasCompletedOnboarding());
  const [recentCommands, setRecentCommands] = useState([]);

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

          const eventType = data?.event_type;
          const payload = data?.data || {};
          if (eventType === 'resolution_options' && payload.node_id) {
            setConflictData((prev) => ({
              ...prev,
              options: Array.isArray(payload.options) ? payload.options : prev.options,
            }));
          } else if (eventType === 'conflict_detected') {
            setConflictData((prev) => ({
              ...prev,
              conflicts: [...(prev.conflicts || []), payload],
            }));
          }

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

  const handleCommand = useCallback(async (query) => {
    if (isChatting || isLoadingGraph || isSeeding) return;

    setIsChatting(true);
    setUiError('');
    setUiSuccess('');
    
    try {
      appendAgentEvent(setAgentEvents, {
        agent: 'Chat Agent',
        action: 'Natural Language',
        message: `Processing: "${query}"`,
      });

      const context = `Current time: ${new Date().toISOString()}. ${
        selectedNode 
          ? `Selected node: "${selectedNode.title}" at ${selectedNode.start_time}` 
          : 'No node selected.'
      }`;

      let responseText = '';
      let toolCalls = [];

      await chatApi.streamMessage(query, context, {
        onText: (chunk) => {
          responseText += chunk;
        },
        onToolCall: (name, args) => {
          toolCalls.push({ name, args });
          appendAgentEvent(setAgentEvents, {
            agent: 'Chat Agent',
            action: 'Tool Call',
            message: `Executing: ${name}`,
          });
        },
        onToolResult: (name, result) => {
          appendAgentEvent(setAgentEvents, {
            agent: 'Chat Agent',
            action: 'Tool Result',
            message: result.length > 80 ? result.substring(0, 80) + '...' : result,
          });
        },
        onDone: () => {
          appendAgentEvent(setAgentEvents, {
            agent: 'Chat Agent',
            action: 'Complete',
            message: 'Response delivered',
          });
        },
        onError: (error) => {
          setUiError(error.message || 'Chat processing failed');
        },
      });

      const calendarModified = toolCalls.some(tc => 
        tc.name === 'reschedule_event' || tc.name === 'create_event'
      );
      
      if (calendarModified) {
        await fetchGraph();
        setUiSuccess(`AI executed calendar action. ${responseText.substring(0, 100)}${responseText.length > 100 ? '...' : ''}`);
      } else if (responseText) {
        setUiSuccess(responseText.substring(0, 150) + (responseText.length > 150 ? '...' : ''));
      }

    } catch (err) {
      setUiError(err.message || 'Unable to process natural language command.');
    } finally {
      setIsChatting(false);
    }
  }, [fetchGraph, isLoadingGraph, isSeeding, isChatting, selectedNode]);

  const undoCascade = useCallback(async () => {
    if (!latestSnapshotId || isUndoing) return;

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
      setUiSuccess('Undo complete. Workflow restored.');
    } catch (err) {
      setUiError(err.message || 'Failed to undo cascade.');
    } finally {
      setIsUndoing(false);
    }
  }, [fetchGraph, isUndoing, latestSnapshotId]);

  const handleOpenCreateNode = useCallback(() => {
    setEditingNode(null);
    setShowNodeModal(true);
  }, []);

  const handleOpenEditNode = useCallback((node) => {
    setEditingNode(node);
    setShowNodeModal(true);
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════════
  // KEYBOARD SHORTCUTS
  // ═══════════════════════════════════════════════════════════════════════════════
  
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Cmd/Ctrl + K = Command Palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette(true);
      }
      // Escape closes modals
      if (e.key === 'Escape') {
        if (showCommandPalette) setShowCommandPalette(false);
      }
      // N = New node (when no modal is open)
      if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !showCommandPalette && !showNodeModal) {
        const activeElement = document.activeElement;
        if (activeElement.tagName !== 'INPUT' && activeElement.tagName !== 'TEXTAREA') {
          e.preventDefault();
          handleOpenCreateNode();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleOpenCreateNode, showCommandPalette, showNodeModal]);

  // ═══════════════════════════════════════════════════════════════════════════════
  // NODE CRUD HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════════

  const handleSaveNode = useCallback(async (nodeData) => {
    setUiError('');
    try {
      if (editingNode) {
        await dagApi.updateNode(editingNode.id, nodeData);
        setUiSuccess(`Updated "${nodeData.title}"`);
      } else {
        await dagApi.createNode(nodeData);
        setUiSuccess(`Created "${nodeData.title}"`);
      }
      setShowNodeModal(false);
      setEditingNode(null);
      await fetchGraph();
    } catch (err) {
      setUiError(err.message || 'Failed to save node.');
    }
  }, [editingNode, fetchGraph]);

  const handleDeleteNode = useCallback(async (nodeId) => {
    setUiError('');
    try {
      await dagApi.deleteNode(nodeId);
      setShowNodeModal(false);
      setEditingNode(null);
      setSelectedNodeId(null);
      setUiSuccess('Node deleted successfully.');
      await fetchGraph();
    } catch (err) {
      setUiError(err.message || 'Failed to delete node.');
    }
  }, [fetchGraph]);

  // ═══════════════════════════════════════════════════════════════════════════════
  // DRAG-TO-RESCHEDULE WITH CASCADE PREVIEW
  // ═══════════════════════════════════════════════════════════════════════════════

  const handleNodeDragEnd = useCallback(async (nodeId, newTime) => {
    if (!nodeId || !newTime) return;
    
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    setUiError('');
    appendAgentEvent(setAgentEvents, {
      agent: 'Cascade Engine',
      action: 'Preview Request',
      message: `Calculating impact of moving "${node.title}"...`,
    });

    try {
      const preview = await dagApi.previewCascade(nodeId, newTime);
      
      setCascadePreviewData(preview);
      setPendingCascade({ nodeId, newTime, node });
      
      // Check for conflicts
      if (preview.has_conflicts && preview.conflicts.length > 0) {
        const resolutionRes = await dagApi.getResolutionOptions(nodeId, preview.conflicts);
        // Show conflict resolution modal instead of preview
        setConflictData({
          conflicts: preview.conflicts,
          options: Array.isArray(resolutionRes?.options) ? resolutionRes.options : [],
        });
        setShowConflictResolution(true);
      } else {
        setShowCascadePreview(true);
      }
    } catch (err) {
      setUiError(err.message || 'Failed to preview cascade.');
    }
  }, [nodes]);

  const handleConfirmCascade = useCallback(async () => {
    if (!pendingCascade) return;
    
    setShowCascadePreview(false);
    setUiError('');
    
    try {
      const res = await dagApi.triggerCascade({
        trigger_node_id: pendingCascade.nodeId,
        new_start_time: pendingCascade.newTime,
        description: `Drag-to-reschedule: ${pendingCascade.node.title}`,
      });
      
      const affected = Array.isArray(res?.changes)
        ? res.changes.map(c => c.node_id).filter(id => typeof id === 'number')
        : [];
      
      setCascadingNodeIds(affected);
      setLatestSnapshotId(res?.snapshot_id || null);
      setSelectedNodeId(pendingCascade.nodeId);
      await fetchGraph();
      setUiSuccess(`Cascade applied: ${Math.max(affected.length - 1, 0)} node(s) adjusted.`);
      
      if (clearHighlightsTimeoutRef.current) {
        clearTimeout(clearHighlightsTimeoutRef.current);
      }
      clearHighlightsTimeoutRef.current = setTimeout(() => {
        setCascadingNodeIds([]);
      }, HIGHLIGHT_DURATION_MS);
    } catch (err) {
      setUiError(err.message || 'Failed to apply cascade.');
    } finally {
      setPendingCascade(null);
      setCascadePreviewData(null);
    }
  }, [pendingCascade, fetchGraph]);

  const handleSelectResolution = useCallback(async (resolution) => {
    setShowConflictResolution(false);
    setUiSuccess(`Applied resolution: ${resolution.title}`);
    if (!pendingCascade) return;

    const adjustedTime = new Date(pendingCascade.newTime);
    const action = resolution?.action || {};
    if (action.type === 'adjust_trigger' && Number.isFinite(action.delta_minutes)) {
      adjustedTime.setMinutes(adjustedTime.getMinutes() + action.delta_minutes);
    }

    const refreshedPreview = await dagApi.previewCascade(pendingCascade.nodeId, adjustedTime);
    setCascadePreviewData(refreshedPreview);
    setPendingCascade((prev) => (prev ? { ...prev, newTime: adjustedTime } : prev));
    setShowCascadePreview(true);
  }, [pendingCascade]);

  // ═══════════════════════════════════════════════════════════════════════════════
  // COMMAND PALETTE HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════════

  const handleExecuteCommand = useCallback((command) => {
    // Add to recent commands
    setRecentCommands(prev => {
      const filtered = prev.filter(c => c.id !== command.id);
      return [command, ...filtered].slice(0, 5);
    });

    switch (command.action) {
      case 'ADD_NODE':
        handleOpenCreateNode();
        break;
      case 'SEED_DEMO':
        seedData();
        break;
      case 'UNDO_CASCADE':
        undoCascade();
        break;
      case 'SELECT_NODE':
        if (command.payload) {
          setSelectedNodeId(command.payload.id);
          handleOpenEditNode(command.payload);
        }
        break;
      default:
        console.log('Unknown command:', command);
    }
  }, [handleOpenCreateNode, seedData, undoCascade, handleOpenEditNode]);

  const handleNaturalLanguage = useCallback((query) => {
    handleCommand(query);
  }, [handleCommand]);

  // ═══════════════════════════════════════════════════════════════════════════════
  // ONBOARDING
  // ═══════════════════════════════════════════════════════════════════════════════

  const handleOnboardingComplete = useCallback(async () => {
    window.localStorage.setItem(ONBOARDING_KEY, 'true');
    setShowOnboarding(false);
    // Auto-seed demo data after onboarding
    await seedData();
  }, [seedData]);

  return (
    <div className="app-container">
      <header className="header glass-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <h1><span className="gradient-text-accent">⚡ CASCADE</span></h1>
          <span className={`stream-pill ${isStreamConnected ? 'connected' : 'disconnected'}`}>
            {isStreamConnected ? 'Live' : 'Reconnecting'}
          </span>
        </div>
        <CommandBar onCommand={handleCommand} disabled={isChatting} />
        
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button
            className="btn-icon"
            onClick={() => setShowCommandPalette(true)}
            title="Command Palette (⌘K)"
          >
            <FaKeyboard />
          </button>
          <button
            className="btn-icon"
            onClick={handleThemeToggle}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? <FaSun /> : <FaMoon />}
          </button>
          <button
            className="btn-icon"
            onClick={seedData}
            title="Reset to Demo State"
            disabled={isSeeding || isLoadingGraph || isUndoing || isChatting}
          >
            <FaSync className={isSeeding ? 'spin' : ''} />
          </button>
          {latestSnapshotId && (
            <button
              className="btn-icon"
              onClick={undoCascade}
              style={{ color: 'var(--warning)', borderColor: 'var(--warning)' }}
              disabled={isUndoing || isSeeding || isLoadingGraph || isChatting}
            >
              <FaUndoAlt style={{ marginRight: '8px' }} /> {isUndoing ? 'Undoing...' : 'Undo'}
            </button>
          )}
          <button
            className="btn-primary"
            onClick={handleOpenCreateNode}
            disabled={isLoadingGraph}
          >
            <FaPlus style={{ marginRight: '8px' }} />
            Add Node
          </button>
        </div>
      </header>

      <section className="workflow-strip glass-panel" aria-label="Orchestrator workflow summary">
        <div className="workflow-strip-header">
          <h2>Intelligent Orchestrator</h2>
          <p>Intent → Conflict Detection → Resolution → Cascade</p>
        </div>
        <div className="workflow-track">
          <span className="workflow-chip orchestrator">Parse Intent</span>
          <span className="workflow-arrow">→</span>
          <span className="workflow-chip">Detect Conflicts</span>
          <span className="workflow-arrow">→</span>
          <span className="workflow-chip">Generate Resolutions</span>
          <span className="workflow-arrow">→</span>
          <span className="workflow-chip">Execute Cascade</span>
        </div>
        <div className="workflow-note">
          Drag any node to reschedule • Press ⌘K for command palette • Type naturally in the command bar
        </div>
      </section>

      {uiError && (
        <div className="error-banner" role="alert">
          {uiError}
          <button className="banner-close" onClick={() => setUiError('')}>×</button>
        </div>
      )}

      {uiSuccess && (
        <div className="success-banner" role="status">
          {uiSuccess}
          <button className="banner-close" onClick={() => setUiSuccess('')}>×</button>
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
            <h2 style={{ fontSize: '1.2rem' }}>Workflow Dependency Graph</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Drag nodes to reschedule • Double-click to edit
            </p>
          </div>
          <DAGGraph
            nodesData={nodes}
            edgesData={edges}
            cascadingNodeIds={cascadingNodeIds}
            selectedNodeId={selectedNodeId}
            onNodeSelect={handleNodeSelect}
            onNodeDragEnd={handleNodeDragEnd}
            onNodeDoubleClick={handleOpenEditNode}
            isLoading={isLoadingGraph}
          />
        </div>
        
        <div className="sidebar">
          <Timeline
            nodes={nodes}
            selectedNodeId={selectedNodeId}
            onNodeSelect={handleNodeSelect}
            onNodeDoubleClick={handleOpenEditNode}
            cascadingNodeIds={cascadingNodeIds}
            isLoading={isLoadingGraph}
          />
          <NodeDetailsPanel 
            node={selectedNode} 
            onEdit={handleOpenEditNode}
            onDelete={handleDeleteNode}
          />
        </div>
      </main>

      {/* Modals */}
      {showNodeModal && (
        <NodeModal
          isOpen={showNodeModal}
          onClose={() => { setShowNodeModal(false); setEditingNode(null); }}
          onSave={handleSaveNode}
          onDelete={handleDeleteNode}
          node={editingNode}
        />
      )}

      {showCascadePreview && (
        <CascadePreviewModal
          isOpen={showCascadePreview}
          onClose={() => { setShowCascadePreview(false); setPendingCascade(null); }}
          onConfirm={handleConfirmCascade}
          preview={cascadePreviewData}
          triggerNode={pendingCascade?.node}
          newTime={pendingCascade?.newTime}
        />
      )}

      {showConflictResolution && (
        <ConflictResolutionModal
          isOpen={showConflictResolution}
          onClose={() => setShowConflictResolution(false)}
          onSelectResolution={handleSelectResolution}
          conflicts={conflictData.conflicts}
          resolutionOptions={conflictData.options}
        />
      )}

      {showCommandPalette && (
        <CommandPalette
          isOpen={showCommandPalette}
          onClose={() => setShowCommandPalette(false)}
          onExecuteCommand={handleExecuteCommand}
          onNaturalLanguage={handleNaturalLanguage}
          nodes={nodes}
          recentCommands={recentCommands}
          canUndo={!!latestSnapshotId}
        />
      )}

      {showOnboarding && (
        <OnboardingModal
          isOpen={showOnboarding}
          onComplete={handleOnboardingComplete}
        />
      )}
    </div>
  );
}

export default App;
