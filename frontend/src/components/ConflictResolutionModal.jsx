import React, { useState } from 'react';
import { 
  FaTimes, FaExclamationTriangle, FaCheck, FaClock, 
  FaCalendarAlt, FaCut, FaTrashAlt, FaMagic, FaArrowRight 
} from 'react-icons/fa';

const RESOLUTION_ICONS = {
  move_deadline: <FaClock />,
  split_task: <FaCut />,
  cancel_event: <FaTrashAlt />,
  find_alternative_time: <FaCalendarAlt />,
  shorten_duration: <FaClock />,
  default: <FaMagic />,
};

const getImpactColor = (score) => {
  if (score <= 30) return 'var(--success)';
  if (score <= 60) return 'var(--warning)';
  return 'var(--danger)';
};

const getImpactLabel = (score) => {
  if (score <= 30) return 'Low Impact';
  if (score <= 60) return 'Medium Impact';
  return 'High Impact';
};

export const ConflictResolutionModal = ({
  isOpen,
  onClose,
  onSelectResolution,
  conflicts = [],
  resolutionOptions = [],
  isLoading = false,
}) => {
  const [selectedOption, setSelectedOption] = useState(null);
  const [hoveredOption, setHoveredOption] = useState(null);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (selectedOption) {
      onSelectResolution(selectedOption);
    }
  };

  return (
    <div 
      className="modal-overlay conflict-resolution-overlay" 
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal-content conflict-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header conflict-modal-header">
          <div>
            <h2>
              <FaExclamationTriangle style={{ marginRight: 8, color: 'var(--warning)' }} />
              Conflict Resolution
            </h2>
            <p className="modal-subtitle">
              {conflicts.length} conflict{conflicts.length !== 1 ? 's' : ''} detected. Choose how to proceed.
            </p>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <FaTimes />
          </button>
        </div>
        
        <div className="modal-body conflict-modal-body">
          {/* Conflicts Summary */}
          <div className="conflicts-summary">
            <h3>Detected Issues</h3>
            <div className="conflicts-list">
              {conflicts.map((conflict, index) => {
                const severity = conflict?.severity || 'warning';
                return (
                  <div key={index} className={`conflict-item severity-${severity}`}>
                    <FaExclamationTriangle className="conflict-icon" />
                    <div className="conflict-details">
                      <span className="conflict-type">{String(conflict?.type || 'unknown').replace(/_/g, ' ')}</span>
                      {conflict.node_title && (
                        <span className="conflict-node">{conflict.node_title}</span>
                      )}
                      {conflict.details?.message && (
                        <span className="conflict-message">{conflict.details.message}</span>
                      )}
                    </div>
                    <span className={`severity-badge ${severity}`}>
                      {severity}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          
          {/* Resolution Options */}
          {resolutionOptions.length > 0 && (
            <div className="resolution-options">
              <h3>AI-Suggested Resolutions</h3>
              <p className="resolution-hint">Select an option to resolve the conflicts</p>
              
              <div className="options-grid">
                {resolutionOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`resolution-option ${selectedOption?.id === option.id ? 'selected' : ''} ${hoveredOption?.id === option.id ? 'hovered' : ''}`}
                    onClick={() => setSelectedOption(option)}
                    onMouseEnter={() => setHoveredOption(option)}
                    onMouseLeave={() => setHoveredOption(null)}
                  >
                    <div className="option-header">
                      <div className="option-icon">
                        {RESOLUTION_ICONS[option.action?.type] || RESOLUTION_ICONS.default}
                      </div>
                      <div className="option-title">{option.title}</div>
                      <div 
                        className="option-impact"
                        style={{ 
                          backgroundColor: `${getImpactColor(option.impact_score)}20`,
                          color: getImpactColor(option.impact_score),
                          borderColor: getImpactColor(option.impact_score)
                        }}
                      >
                        {getImpactLabel(option.impact_score)}
                      </div>
                    </div>
                    
                    <p className="option-description">{option.description}</p>
                    
                    {option.trade_offs && option.trade_offs.length > 0 && (
                      <div className="option-tradeoffs">
                        <span className="tradeoff-label">Trade-offs:</span>
                        <ul>
                          {option.trade_offs.map((tradeoff, ti) => (
                            <li key={ti}>{tradeoff}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    
                    <div className="option-impact-bar">
                      <div 
                        className="impact-fill"
                        style={{ 
                          width: `${option.impact_score}%`,
                          backgroundColor: getImpactColor(option.impact_score)
                        }}
                      />
                    </div>
                    
                    {selectedOption?.id === option.id && (
                      <div className="selected-indicator">
                        <FaCheck /> Selected
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
          
          {resolutionOptions.length === 0 && (
            <div className="no-resolutions">
              <FaMagic className="no-resolutions-icon" />
              <p>No automatic resolutions available. You may need to manually adjust the schedule.</p>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={isLoading}>
            Cancel
          </button>
          <button 
            type="button" 
            className="btn-primary"
            onClick={handleConfirm}
            disabled={isLoading || !selectedOption}
          >
            {isLoading ? 'Applying...' : (
              <>
                <FaCheck style={{ marginRight: 6 }} />
                Apply Resolution
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
