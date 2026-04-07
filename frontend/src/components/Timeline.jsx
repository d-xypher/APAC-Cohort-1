import React from 'react';

export const Timeline = ({ nodes }) => {
  // Sort nodes by start_time
  const sortedNodes = [...nodes].filter(n => n.start_time).sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

  const formatTime = (isoString) => {
    if (!isoString) return '';
    return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '16px', borderBottom: '1px solid var(--glass-border)' }}>
        <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Schedule</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Priya's Day</p>
      </div>
      
      <div className="timeline">
        {sortedNodes.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No events scheduled.</div>
        ) : (
          sortedNodes.map(node => (
            <div key={node.id} className="timeline-item">
              <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{node.title}</div>
              <div style={{ display: 'flex', alignItems: 'center', marginTop: '4px' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {formatTime(node.start_time)} - {formatTime(node.end_time)}
                </span>
                {node.cascade_note && (
                  <span className="time-badge" style={{ color: 'var(--warning)' }}>
                    Auto-Adjusted
                  </span>
                )}
              </div>
              {node.cascade_note && (
                <div style={{ 
                  marginTop: '8px', 
                  fontSize: '0.8rem', 
                  color: 'var(--warning)', 
                  background: 'rgba(255, 184, 0, 0.1)',
                  padding: '8px',
                  borderRadius: '4px',
                  borderLeft: '2px solid var(--warning)'
                }}>
                  {node.cascade_note}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
