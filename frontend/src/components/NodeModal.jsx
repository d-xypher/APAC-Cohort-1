import React, { useCallback, useState } from 'react';
import { FaTimes, FaSave, FaTrash, FaCalendarAlt, FaTasks, FaStickyNote, FaBrain } from 'react-icons/fa';

const NODE_TYPES = [
  { value: 'calendar_event', label: 'Calendar Event', icon: <FaCalendarAlt /> },
  { value: 'task', label: 'Task', icon: <FaTasks /> },
  { value: 'note', label: 'Note', icon: <FaStickyNote /> },
  { value: 'focus_block', label: 'Focus Block', icon: <FaBrain /> },
];

const NODE_STATUSES = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'rescheduled', label: 'Rescheduled' },
];

const formatDateTimeLocal = (isoString) => {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '';
  // Format as YYYY-MM-DDTHH:MM for datetime-local input
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const buildInitialFormData = (node) => {
  if (node) {
    return {
      title: node.title || '',
      description: node.description || '',
      node_type: node.node_type || 'task',
      status: node.status || 'scheduled',
      start_time: formatDateTimeLocal(node.start_time),
      end_time: formatDateTimeLocal(node.end_time),
      duration_minutes: node.duration_minutes || 60,
      deadline: formatDateTimeLocal(node.deadline),
      priority: node.priority || 3,
    };
  }

  const defaultStart = new Date();
  defaultStart.setHours(defaultStart.getHours() + 1, 0, 0, 0);
  const defaultEnd = new Date(defaultStart);
  defaultEnd.setHours(defaultEnd.getHours() + 1);

  return {
    title: '',
    description: '',
    node_type: 'task',
    status: 'scheduled',
    start_time: formatDateTimeLocal(defaultStart),
    end_time: formatDateTimeLocal(defaultEnd),
    duration_minutes: 60,
    deadline: '',
    priority: 3,
  };
};

export const NodeModal = ({
  isOpen,
  onClose,
  onSave,
  onDelete,
  node = null, // null for create, object for edit
  isLoading = false,
}) => {
  const isEditMode = !!node;
  
  const [formData, setFormData] = useState(() => buildInitialFormData(node));
  
  const [errors, setErrors] = useState({});

  const handleChange = useCallback((field, value) => {
    setFormData(prev => {
      const next = { ...prev, [field]: value };
      
      // Auto-calculate end_time from duration
      if (field === 'start_time' || field === 'duration_minutes') {
        if (next.start_time && next.duration_minutes) {
          const start = new Date(next.start_time);
          if (!isNaN(start.getTime())) {
            const end = new Date(start.getTime() + next.duration_minutes * 60 * 1000);
            next.end_time = formatDateTimeLocal(end);
          }
        }
      }
      
      return next;
    });
    
    // Clear error for this field
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  }, [errors]);

  const validate = useCallback(() => {
    const newErrors = {};
    
    if (!formData.title.trim()) {
      newErrors.title = 'Title is required';
    }
    
    if (!formData.start_time) {
      newErrors.start_time = 'Start time is required';
    }
    
    if (formData.start_time && formData.end_time) {
      const start = new Date(formData.start_time);
      const end = new Date(formData.end_time);
      if (end <= start) {
        newErrors.end_time = 'End time must be after start time';
      }
    }
    
    if (formData.deadline && formData.start_time) {
      const start = new Date(formData.start_time);
      const deadline = new Date(formData.deadline);
      if (deadline < start) {
        newErrors.deadline = 'Deadline cannot be before start time';
      }
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData]);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    
    if (!validate()) return;
    
    const payload = {
      ...formData,
      start_time: formData.start_time ? new Date(formData.start_time).toISOString() : null,
      end_time: formData.end_time ? new Date(formData.end_time).toISOString() : null,
      deadline: formData.deadline ? new Date(formData.deadline).toISOString() : null,
      duration_minutes: parseInt(formData.duration_minutes, 10) || 60,
      priority: parseInt(formData.priority, 10) || 3,
    };
    
    onSave(payload);
  }, [formData, validate, onSave]);

  const handleDelete = useCallback(() => {
    if (node && window.confirm(`Delete "${node.title}"? This cannot be undone.`)) {
      onDelete(node.id);
    }
  }, [node, onDelete]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      onClose();
    }
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div 
      className="modal-overlay" 
      onClick={onClose}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="node-modal-title"
    >
      <div className="modal-content node-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="node-modal-title">
            {isEditMode ? 'Edit Node' : 'Create New Node'}
          </h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <FaTimes />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="modal-body">
          {/* Title */}
          <div className="form-group">
            <label htmlFor="node-title">Title *</label>
            <input
              id="node-title"
              type="text"
              value={formData.title}
              onChange={e => handleChange('title', e.target.value)}
              placeholder="e.g., Team Standup, Review PR #123"
              className={errors.title ? 'error' : ''}
              autoFocus
            />
            {errors.title && <span className="error-text">{errors.title}</span>}
          </div>
          
          {/* Type and Status Row */}
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="node-type">Type</label>
              <div className="type-selector">
                {NODE_TYPES.map(type => (
                  <button
                    key={type.value}
                    type="button"
                    className={`type-btn ${formData.node_type === type.value ? 'active' : ''}`}
                    onClick={() => handleChange('node_type', type.value)}
                    title={type.label}
                  >
                    {type.icon}
                    <span>{type.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          
          {/* Time Row */}
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="node-start">Start Time *</label>
              <input
                id="node-start"
                type="datetime-local"
                value={formData.start_time}
                onChange={e => handleChange('start_time', e.target.value)}
                className={errors.start_time ? 'error' : ''}
              />
              {errors.start_time && <span className="error-text">{errors.start_time}</span>}
            </div>
            
            <div className="form-group">
              <label htmlFor="node-duration">Duration (min)</label>
              <input
                id="node-duration"
                type="number"
                min="5"
                max="480"
                step="5"
                value={formData.duration_minutes}
                onChange={e => handleChange('duration_minutes', e.target.value)}
              />
            </div>
          </div>
          
          {/* End Time and Deadline */}
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="node-end">End Time</label>
              <input
                id="node-end"
                type="datetime-local"
                value={formData.end_time}
                onChange={e => handleChange('end_time', e.target.value)}
                className={errors.end_time ? 'error' : ''}
              />
              {errors.end_time && <span className="error-text">{errors.end_time}</span>}
            </div>
            
            <div className="form-group">
              <label htmlFor="node-deadline">Deadline (optional)</label>
              <input
                id="node-deadline"
                type="datetime-local"
                value={formData.deadline}
                onChange={e => handleChange('deadline', e.target.value)}
                className={errors.deadline ? 'error' : ''}
              />
              {errors.deadline && <span className="error-text">{errors.deadline}</span>}
            </div>
          </div>
          
          {/* Priority and Status */}
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="node-priority">Priority</label>
              <select
                id="node-priority"
                value={formData.priority}
                onChange={e => handleChange('priority', e.target.value)}
              >
                <option value="1">🔴 Critical (1)</option>
                <option value="2">🟠 High (2)</option>
                <option value="3">🟡 Medium (3)</option>
                <option value="4">🟢 Low (4)</option>
                <option value="5">⚪ Optional (5)</option>
              </select>
            </div>
            
            <div className="form-group">
              <label htmlFor="node-status">Status</label>
              <select
                id="node-status"
                value={formData.status}
                onChange={e => handleChange('status', e.target.value)}
              >
                {NODE_STATUSES.map(status => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          
          {/* Description */}
          <div className="form-group">
            <label htmlFor="node-description">Description</label>
            <textarea
              id="node-description"
              value={formData.description}
              onChange={e => handleChange('description', e.target.value)}
              placeholder="Optional notes or context..."
              rows={3}
            />
          </div>
        </form>
        
        <div className="modal-footer">
          {isEditMode && (
            <button 
              type="button" 
              className="btn-danger" 
              onClick={handleDelete}
              disabled={isLoading}
            >
              <FaTrash style={{ marginRight: 6 }} />
              Delete
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button type="button" className="btn-secondary" onClick={onClose} disabled={isLoading}>
            Cancel
          </button>
          <button 
            type="submit" 
            className="btn-primary" 
            onClick={handleSubmit}
            disabled={isLoading}
          >
            <FaSave style={{ marginRight: 6 }} />
            {isLoading ? 'Saving...' : (isEditMode ? 'Save Changes' : 'Create Node')}
          </button>
        </div>
      </div>
    </div>
  );
};
