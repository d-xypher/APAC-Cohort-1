import React from 'react';
import { FaRobot, FaCalendar, FaTasks, FaBook } from 'react-icons/fa';

const formatAgo = (nowMs, timestamp) => {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return '';
  }

  const delta = Math.max(0, nowMs - timestamp);
  if (delta < 1000) {
    return 'just now';
  }
  if (delta < 60000) {
    return `${Math.floor(delta / 1000)}s ago`;
  }
  return `${Math.floor(delta / 60000)}m ago`;
};

export const AgentPanel = ({ events, isStreamConnected, nowMs }) => {
  const agents = [
    { name: 'Orchestrator', icon: <FaRobot /> },
    { name: 'Calendar Agent', icon: <FaCalendar /> },
    { name: 'Task Agent', icon: <FaTasks /> },
    { name: 'Notes Agent', icon: <FaBook /> },
  ];

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '16px', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Mission Control</h2>
          <p className="agent-subtitle">Orchestrator coordinates Calendar, Task, and Notes agents</p>
          <p className="agent-flow">Trigger -&gt; Propagation -&gt; Logging</p>
        </div>
        <span className={`connection-pill ${isStreamConnected ? 'connected' : 'disconnected'}`}>
          {isStreamConnected ? 'Live' : 'Retrying'}
        </span>
      </div>
      
      <div className="agent-list">
        {events.length === 0 && (
          <div className="agent-empty">No agent events yet. Trigger a seed or cascade action.</div>
        )}
        {agents.map(agent => {
          // Find latest event for this agent
          const latestEvent = [...events].reverse().find(e => e.agent === agent.name);
          const latestTimestamp = Number(latestEvent?.timestamp || 0);
          const isActive = latestEvent && Number.isFinite(latestTimestamp) && (nowMs - latestTimestamp < 5000);

          return (
            <div key={agent.name} className={`agent-item ${isActive ? 'active' : ''}`}>
              <div className={`status-indicator ${isActive ? 'active' : ''}`}></div>
              <div style={{ color: isActive ? 'var(--cyan)' : 'var(--text-primary)', fontSize: '1.2rem'}}>
                {agent.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{agent.name}</div>
                <div style={{ 
                  fontSize: '0.8rem', 
                  color: 'var(--text-muted)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {latestEvent ? `${latestEvent.action}: ${latestEvent.message}` : 'Idle'}
                </div>
                {latestEvent && (
                  <div className="agent-time">{formatAgo(nowMs, latestTimestamp)}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
