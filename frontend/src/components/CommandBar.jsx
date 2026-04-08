import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

/* ─── Quick-action suggestions ────────────────────────────── */
const SUGGESTIONS = [
  {
    icon: '⚡',
    label: 'Push standup by 30 minutes',
    action: 'cascade',
  },
  {
    icon: '🛡️',
    label: 'Guard my focus blocks',
    action: 'focus',
  },
  {
    icon: '📋',
    label: 'Create a new task at 2 PM',
    action: 'create',
  },
  {
    icon: '🔁',
    label: 'Undo last cascade',
    action: 'undo',
  },
];

/* ─── Overlay animation variants ──────────────────────────── */
const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

const panelVariants = {
  hidden: { opacity: 0, scale: 0.96, y: -12 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: 'spring', damping: 28, stiffness: 400 },
  },
  exit: {
    opacity: 0,
    scale: 0.96,
    y: -8,
    transition: { duration: 0.12, ease: 'easeIn' },
  },
};

const statusVariants = {
  hidden: { opacity: 0, height: 0 },
  visible: { opacity: 1, height: 'auto', transition: { duration: 0.2 } },
  exit: { opacity: 0, height: 0, transition: { duration: 0.15 } },
};


export const CommandBar = ({ onCommand }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState(null); // null | 'processing' | 'success' | 'error'
  const [statusMessage, setStatusMessage] = useState('');
  const inputRef = useRef(null);
  const timeoutRef = useRef(null);

  // ── Keyboard shortcut: Cmd/Ctrl + K ──
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ── Auto-focus when opened ──
  useEffect(() => {
    if (isOpen && inputRef.current) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    if (!isOpen) {
      setStatus(null);
      setStatusMessage('');
    }
  }, [isOpen]);

  // ── Clear status after delay ──
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    setStatus('processing');
    setStatusMessage(`Routing "${trimmed}" through Cascade Intelligence...`);

    try {
      if (onCommand) {
        await onCommand(trimmed);
      }
      setStatus('success');
      setStatusMessage('Command executed successfully.');
      
      timeoutRef.current = setTimeout(() => {
        setIsOpen(false);
        setQuery('');
        setStatus(null);
      }, 1200);
    } catch (err) {
      setStatus('error');
      setStatusMessage(err.message || 'Command failed.');
      
      timeoutRef.current = setTimeout(() => {
        setStatus(null);
      }, 3000);
    }
  }, [query, onCommand]);

  const handleSuggestion = useCallback((suggestion) => {
    setQuery(suggestion.label);
    // Let the user see what was filled, then auto-submit
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  // ── Filter suggestions by query ──
  const filteredSuggestions = query.trim()
    ? SUGGESTIONS.filter((s) =>
        s.label.toLowerCase().includes(query.toLowerCase())
      )
    : SUGGESTIONS;

  const renderOverlay = () => {
    // Only return null if document undefined (SSR safety)
    if (typeof document === 'undefined') return null;
    
    return createPortal(
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              className="command-overlay"
              variants={overlayVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              transition={{ duration: 0.15 }}
              onClick={() => setIsOpen(false)}
            />

            {/* Panel */}
            <motion.div
              className="command-container"
              variants={panelVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              <div className="command-panel">
                {/* Input row */}
                <form onSubmit={handleSubmit} className="command-input-row">
                  <svg
                    className={`command-icon ${status === 'processing' ? 'pulse' : ''}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Move standup 30 mins, guard my focus, create task..."
                    className="command-input"
                    autoComplete="off"
                    spellCheck="false"
                    disabled={status === 'processing'}
                  />
                  <span className="command-kbd">ESC</span>
                </form>

                {/* Suggestions / Actions */}
                <div className="command-footer">
                  <div className="command-footer-label">Actions</div>
                  <div className="command-actions">
                    {filteredSuggestions.map((suggestion) => (
                      <button
                        key={suggestion.label}
                        className="command-action-item"
                        type="button"
                        onClick={() => handleSuggestion(suggestion)}
                      >
                        <span style={{ fontSize: '14px', flexShrink: 0 }}>{suggestion.icon}</span>
                        <span className="command-action-label">{suggestion.label}</span>
                        <span className="command-action-kbd">↵</span>
                      </button>
                    ))}
                    {filteredSuggestions.length === 0 && (
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', padding: '4px 8px' }}>
                        No matching actions — press Enter to send as natural language.
                      </div>
                    )}
                  </div>
                </div>

                {/* Processing / Status indicator */}
                <AnimatePresence>
                  {status && (
                    <motion.div
                      className="command-status"
                      variants={statusVariants}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                    >
                      <span className={`command-status-dot ${status}`} />
                      <span className="command-status-text">{statusMessage}</span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>,
      document.body
    );
  };

  return (
    <>
      {/* Inline trigger button in header */}
      <button
        className="command-trigger"
        onClick={() => setIsOpen(true)}
        type="button"
        aria-label="Open command bar"
      >
        <svg className="command-hint-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <span className="command-trigger-text">Tell Cascade what changed...</span>
        <span className="command-trigger-kbd">⌘K</span>
      </button>

      {/* Full command palette via Portal */}
      {renderOverlay()}
    </>
  );
};
