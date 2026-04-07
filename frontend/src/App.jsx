import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { DAGGraph } from './components/DAGGraph';
import { AgentPanel } from './components/AgentPanel';
import { Timeline } from './components/Timeline';
import { FaUndoAlt, FaPlay, FaSync } from 'react-icons/fa';

const API_BASE = 'http://localhost:8000/api';

function App() {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [agentEvents, setAgentEvents] = useState([]);
  const [cascadingNodeIds, setCascadingNodeIds] = useState([]);
  const [latestSnapshotId, setLatestSnapshotId] = useState(null);
  const [isSimulating, setIsSimulating] = useState(false);

  const fetchGraph = async () => {
    try {
      const [nRes, eRes] = await Promise.all([
        axios.get(`${API_BASE}/dag/nodes`),
        axios.get(`${API_BASE}/dag/edges`)
      ]);
      setNodes(nRes.data);
      setEdges(eRes.data);
    } catch (err) {
      console.error("Failed to fetch graph:", err);
    }
  };

  const seedData = async () => {
    await axios.post(`${API_BASE}/seed/`);
    fetchGraph();
    setCascadingNodeIds([]);
    setLatestSnapshotId(null);
  };

  useEffect(() => {
    fetchGraph();
    // Setup SSE for agent events if backend implemented it
    // Left out for demo brevity, but state is ready for it array pusher
  }, []);

  const simulateDisruption = async () => {
    setIsSimulating(true);
    // Find standup
    const standup = nodes.find(n => n.title.includes("Standup"));
    if (!standup) { alert("Seed data first!"); setIsSimulating(false); return; }

    // Push standup time by 1.5 hours
    const oldTime = new Date(standup.start_time);
    const newTime = new Date(oldTime.getTime() + 90 * 60000); // +90 mins

    try {
      // Simulate orchestrator thinking for demo wow factor
      setAgentEvents(prev => [...prev, { agent: 'Orchestrator', action: 'Trigger Detected', message: `Standup moved to ${newTime.toLocaleTimeString()}`, timestamp: Date.now() }]);
      setTimeout(() => setAgentEvents(prev => [...prev, { agent: 'Calendar Agent', action: 'Updating', message: 'Moving standup in Google Calendar.', timestamp: Date.now() }]), 1500);
      
      const res = await axios.post(`${API_BASE}/cascade/trigger`, {
        trigger_node_id: standup.id,
        new_start_time: newTime.toISOString(),
        description: "Standup moved via Calendar UI"
      });

      setTimeout(() => {
        setAgentEvents(prev => [...prev, { agent: 'Task Agent', action: 'Propagating Cascade', message: 'Re-scheduling downstream dependencies.', timestamp: Date.now() }]);
        
        // Highlight nodes
        const affected = res.data.changes.map(c => c.node_id);
        setCascadingNodeIds(affected);
        setLatestSnapshotId(res.data.snapshot_id);
        
        // Fetch new state to update UI
        fetchGraph();
        
        setTimeout(() => {
           setAgentEvents(prev => [...prev, { agent: 'Notes Agent', action: 'Logging', message: `Logged ${affected.length} auto-adjustments.`, timestamp: Date.now() }]);
           setTimeout(() => setCascadingNodeIds([]), 6000); // Clear highlight after 6s
           setIsSimulating(false);
        }, 1500);
      }, 3000);

    } catch (err) {
      console.error(err);
      setIsSimulating(false);
    }
  };

  const undoCascade = async () => {
    if (!latestSnapshotId) return;
    try {
      await axios.post(`${API_BASE}/cascade/undo/${latestSnapshotId}`);
      setLatestSnapshotId(null);
      setCascadingNodeIds([]);
      fetchGraph();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="app-container">
      <header className="header glass-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <h1><span className="gradient-text-accent">🌊 CASCADE</span></h1>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '4px' }}>The Ripple-Effect Workflow Engine</span>
        </div>
        
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn-icon" onClick={seedData} title="Reset to Demo State">
            <FaSync />
          </button>
          {latestSnapshotId && (
            <button className="btn-icon" onClick={undoCascade} style={{ color: 'var(--warning)', borderColor: 'var(--warning)' }}>
              <FaUndoAlt style={{ marginRight: '8px' }} /> Undo Cascade
            </button>
          )}
          <button className="btn-primary" onClick={simulateDisruption} disabled={isSimulating}>
            <FaPlay style={{ marginRight: '8px' }} /> {isSimulating ? 'Cascading...' : 'Simulate Demo Disruption'}
          </button>
        </div>
      </header>

      <main className="main-content">
        <div className="sidebar">
          <AgentPanel events={agentEvents} />
        </div>
        
        <div className="graph-section glass-panel">
          <div style={{ position: 'absolute', top: '16px', left: '20px', zIndex: 10 }}>
            <h2 style={{ fontSize: '1.2rem' }}>Workflow Dependency Graph (DAG)</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Watch the physics of your day</p>
          </div>
          <DAGGraph nodesData={nodes} edgesData={edges} cascadingNodeIds={cascadingNodeIds} />
        </div>
        
        <div className="sidebar">
          <Timeline nodes={nodes} />
        </div>
      </main>
    </div>
  );
}

export default App;
