import React from 'react';

const prettyStatus = (status) => String(status || 'unknown').replace('_', ' ');

export const Timeline = ({
  nodes,
  selectedNodeId,
  onNodeSelect,
  onNodeDoubleClick,
  cascadingNodeIds = [],
  isLoading = false,
}) => {
  // Sort nodes by start_time
  const sortedNodes = [...nodes].filter(n => n.start_time).sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

  const formatTime = (isoString) => {
    if (!isoString) return 'TBD';
    return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '16px', borderBottom: '1px solid var(--glass-border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Schedule</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0, marginTop: 4 }}>
              Live dependency timeline
            </p>
          </div>
          <span style={{ 
            fontSize: '0.7rem', 
            color: 'var(--text-muted)', 
            background: 'var(--bg-tertiary)', 
            padding: '4px 8px', 
            borderRadius: 'var(--radius-sm)',
          }}>
            Double-click to edit
          </span>
        </div>
      </div>
      
      <div className="timeline">
        {isLoading ? (
          <div className="timeline-skeleton">
            <div className="skeleton-line" />
            <div className="skeleton-line short" />
            <div className="skeleton-line" />
          </div>
        ) : sortedNodes.length === 0 ? (
          <div className="timeline-empty">
            <div style={{ fontSize: '2rem', marginBottom: 8 }}>📅</div>
            <div style={{ marginBottom: 4 }}>No events scheduled</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
              Press <kbd style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: 4, fontSize: '0.75rem' }}>N</kbd> to add a task or seed demo data
            </div>
          </div>
        ) : (
          sortedNodes.map(node => (
            <button
              key={node.id}
              type="button"
              className={`timeline-item ${selectedNodeId === node.id ? 'active' : ''} ${cascadingNodeIds.includes(node.id) ? 'cascading' : ''}`}
              onClick={() => onNodeSelect?.(node)}
              onDoubleClick={() => onNodeDoubleClick?.(node)}
              title="Double-click to edit"
            >
              <div className="timeline-title-row">
                <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{node.title}</div>
                <span className="timeline-status-chip">{prettyStatus(node.status)}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', marginTop: '4px' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {formatTime(node.start_time)} - {formatTime(node.end_time)}
                </span>
                {cascadingNodeIds.includes(node.id) && (
                  <span className="time-badge" style={{ color: 'var(--warning)' }}>
                    Cascade Impact
                  </span>
                )}
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
            </button>
          ))
        )}
      </div>
    </div>
  );
};
