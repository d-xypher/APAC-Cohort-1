import React from 'react';

const formatDateTime = (value) => {
  if (!value) {
    return 'Not set';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const detailRows = (node) => [
  ['Type', node.node_type || 'Unknown'],
  ['Status', node.status || 'Unknown'],
  ['Owner', node.owner_id ? `User ${node.owner_id}` : 'Unassigned'],
  ['Start', formatDateTime(node.start_time)],
  ['End', formatDateTime(node.end_time)],
  ['Priority', node.priority ? String(node.priority) : 'Not set'],
  ['Source', node.source || 'Manual'],
];

export const NodeDetailsPanel = ({ node, onEdit, onDelete }) => {
  if (!node) {
    return (
      <div className="glass-panel details-panel details-panel-empty">
        <h3>Node Details</h3>
        <p>Select a node in the DAG or timeline to inspect schedule and dependency metadata.</p>
        <div style={{ marginTop: 16, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          <strong>Tips:</strong>
          <ul style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
            <li>Click a node to view details</li>
            <li>Double-click to edit</li>
            <li>Drag nodes to reschedule</li>
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-panel details-panel glow">
      <div className="details-header">
        <h3>{node.title || 'Untitled Node'}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="details-status">{node.status || 'unknown'}</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => onEdit?.(node)}
          className="btn-secondary"
          style={{ 
            flex: 1, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            gap: 6,
            padding: '8px 12px',
            fontSize: '0.8rem',
          }}
        >
          <span>✏️</span>
          Edit
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Delete "${node.title}"? This will affect dependent tasks.`)) {
              onDelete?.(node.id);
            }
          }}
          className="btn-danger"
          style={{ 
            padding: '8px 12px',
            fontSize: '0.8rem',
            background: 'transparent',
            border: '1px solid var(--error)',
            color: 'var(--error)',
          }}
        >
          🗑️
        </button>
      </div>

      {node.description && (
        <p className="details-description">{node.description}</p>
      )}

      <dl className="details-grid">
        {detailRows(node).map(([label, value]) => (
          <React.Fragment key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </React.Fragment>
        ))}
      </dl>

      {node.cascade_note && (
        <div className="details-note">
          <strong>Cascade Note</strong>
          <p>{node.cascade_note}</p>
        </div>
      )}

      {/* Quick Actions */}
      <div style={{ 
        marginTop: 16, 
        paddingTop: 16, 
        borderTop: '1px solid var(--border-subtle)',
      }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8 }}>
          Quick Actions
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-chip"
            onClick={() => onEdit?.({ ...node, status: 'completed' })}
            style={{ fontSize: '0.7rem', padding: '4px 10px' }}
          >
            ✓ Mark Done
          </button>
          <button
            type="button"
            className="btn-chip"
            onClick={() => onEdit?.({ ...node, priority: (node.priority || 5) - 1 })}
            style={{ fontSize: '0.7rem', padding: '4px 10px' }}
          >
            ⬆️ Priority
          </button>
        </div>
      </div>
    </div>
  );
};
