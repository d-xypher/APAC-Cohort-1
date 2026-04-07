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
  ['Owner', node.owner || 'Unassigned'],
  ['Start', formatDateTime(node.start_time)],
  ['End', formatDateTime(node.end_time)],
  ['Priority', node.priority ? String(node.priority) : 'Not set'],
  ['Source', node.source || 'Manual'],
];

export const NodeDetailsPanel = ({ node }) => {
  if (!node) {
    return (
      <div className="glass-panel details-panel details-panel-empty">
        <h3>Node Details</h3>
        <p>Select a node in the DAG or timeline to inspect schedule and dependency metadata.</p>
      </div>
    );
  }

  return (
    <div className="glass-panel details-panel glow">
      <div className="details-header">
        <h3>{node.title || 'Untitled Node'}</h3>
        <span className="details-status">{node.status || 'unknown'}</span>
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
    </div>
  );
};
