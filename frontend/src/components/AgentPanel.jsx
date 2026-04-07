import React from 'react';
import { FaRobot, FaCalendar, FaTasks, FaBook } from 'react-icons/fa';

export const AgentPanel = ({ events }) => {
  const agents = [
    { name: 'Orchestrator', icon: <FaRobot /> },
    { name: 'Calendar Agent', icon: <FaCalendar /> },
    { name: 'Task Agent', icon: <FaTasks /> },
    { name: 'Notes Agent', icon: <FaBook /> },
  ];

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '16px', borderBottom: '1px solid var(--glass-border)' }}>
        <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Mission Control</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Multi-Agent Coordination</p>
      </div>
      
      <div className="agent-list">
        {agents.map(agent => {
          // Find latest event for this agent
          const latestEvent = [...events].reverse().find(e => e.agent === agent.name);
          const isActive = latestEvent && (Date.now() - latestEvent.timestamp < 5000); // active if event in last 5s

          return (
            <div key={agent.name} className={`agent-item ${isActive ? 'active' : ''}`}>
              <div className={`status-indicator ${isActive ? 'active' : ''}`}></div>
              <div style={{ color: isActive ? 'var(--primary-accent)' : 'var(--text-main)', fontSize: '1.2rem'}}>
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
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
