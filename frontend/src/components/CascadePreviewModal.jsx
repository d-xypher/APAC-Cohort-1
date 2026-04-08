import React from 'react';
import { FaTimes, FaCheck, FaExclamationTriangle, FaClock, FaArrowRight } from 'react-icons/fa';

const formatTime = (isoString) => {
  if (!isoString) return '--:--';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatDelta = (minutes) => {
  if (!minutes) return '0 min';
  const sign = minutes > 0 ? '+' : '';
  if (Math.abs(minutes) >= 60) {
    const hours = Math.floor(Math.abs(minutes) / 60);
    const mins = Math.abs(minutes) % 60;
    return `${sign}${minutes > 0 ? '' : '-'}${hours}h${mins > 0 ? ` ${mins}m` : ''}`;
  }
  return `${sign}${Math.round(minutes)} min`;
};

export const CascadePreviewModal = ({
  isOpen,
  onClose,
  onConfirm,
  preview,
  triggerNode,
  newTime,
  isLoading = false,
}) => {
  if (!isOpen || !preview) return null;

  const { affected_nodes = [], has_conflicts, conflicts = [], summary, total_delay_minutes } = preview;
  const hasCriticalConflicts = conflicts.some(c => c.type === 'DEADLINE_VIOLATION');

  return (
    <div 
      className="modal-overlay cascade-preview-overlay" 
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal-content cascade-preview-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>
              <FaClock style={{ marginRight: 8, color: 'var(--cyan)' }} />
              Cascade Preview
            </h2>
            <p className="modal-subtitle">Review changes before applying</p>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <FaTimes />
          </button>
        </div>
        
        <div className="modal-body cascade-preview-body">
          {/* Summary Banner */}
          <div className={`cascade-summary ${has_conflicts ? 'has-conflicts' : 'no-conflicts'}`}>
            {has_conflicts ? (
              <FaExclamationTriangle className="summary-icon warning" />
            ) : (
              <FaCheck className="summary-icon success" />
            )}
            <div className="summary-text">
              <strong>{summary}</strong>
              <span className="summary-stats">
                {affected_nodes.length} node{affected_nodes.length !== 1 ? 's' : ''} affected • 
                {formatDelta(total_delay_minutes)} total shift
              </span>
            </div>
          </div>
          
          {/* Trigger Node */}
          {triggerNode && (
            <div className="cascade-trigger-node">
              <div className="trigger-label">Trigger</div>
              <div className="trigger-card">
                <div className="trigger-title">{triggerNode.title}</div>
                <div className="trigger-time-change">
                  <span className="old-time">{formatTime(triggerNode.start_time)}</span>
                  <FaArrowRight className="time-arrow" />
                  <span className="new-time">{formatTime(newTime)}</span>
                </div>
              </div>
            </div>
          )}
          
          {/* Affected Nodes */}
          {affected_nodes.length > 0 && (
            <div className="cascade-affected-list">
              <div className="affected-label">
                Ripple Effects ({affected_nodes.length})
              </div>
              <div className="affected-nodes">
                {affected_nodes.map((node, index) => (
                  <div 
                    key={node.id}
                    className={`affected-node visible ${node.has_conflict ? 'has-conflict' : ''}`}
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <div className="affected-node-header">
                      <span className="affected-node-title">{node.title}</span>
                      <span className={`affected-node-delta ${node.delta_minutes > 0 ? 'positive' : 'negative'}`}>
                        {formatDelta(node.delta_minutes)}
                      </span>
                    </div>
                    <div className="affected-node-times">
                      <span className="old-time">{formatTime(node.current_start)}</span>
                      <FaArrowRight className="time-arrow-small" />
                      <span className="new-time">{formatTime(node.new_start)}</span>
                    </div>
                    {node.conflicts && node.conflicts.length > 0 && (
                      <div className="affected-node-conflicts">
                        {node.conflicts.map((conflict, ci) => (
                          <div key={ci} className="conflict-badge">
                            <FaExclamationTriangle />
                            {conflict.message}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {affected_nodes.length === 0 && (
            <div className="no-affected-nodes">
              <FaCheck className="no-affected-icon" />
              <p>No downstream nodes will be affected by this change.</p>
            </div>
          )}
          
          {/* Conflicts Warning */}
          {hasCriticalConflicts && (
            <div className="cascade-conflicts-warning">
              <FaExclamationTriangle className="warning-icon" />
              <div>
                <strong>Deadline Violations Detected</strong>
                <p>This change will cause {conflicts.filter(c => c.type === 'DEADLINE_VIOLATION').length} deadline(s) to be missed. Consider adjusting deadlines or finding an alternative time.</p>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={isLoading}>
            Cancel
          </button>
          <button 
            type="button" 
            className={`btn-primary ${hasCriticalConflicts ? 'btn-warning' : ''}`}
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? 'Applying...' : (
              hasCriticalConflicts ? 'Apply Anyway' : 'Apply Changes'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
