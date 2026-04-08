import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  FaSearch, FaPlus, FaCalendarAlt,
  FaTasks, FaUndo, FaSync, FaMagic, FaKeyboard,
  FaArrowRight, FaHistory
} from 'react-icons/fa';

const STATIC_COMMANDS = [
  {
    id: 'add-node',
    label: 'Add New Node',
    description: 'Create a new task, event, or focus block',
    icon: <FaPlus />,
    category: 'actions',
    action: 'ADD_NODE',
    keywords: ['create', 'new', 'add', 'task', 'event'],
  },
  {
    id: 'seed-demo',
    label: 'Reset Demo Data',
    description: 'Seed the demo graph with sample data',
    icon: <FaSync />,
    category: 'actions',
    action: 'SEED_DEMO',
    keywords: ['reset', 'seed', 'demo', 'sample'],
  },
  {
    id: 'undo-cascade',
    label: 'Undo Last Cascade',
    description: 'Revert the most recent cascade operation',
    icon: <FaUndo />,
    category: 'actions',
    action: 'UNDO_CASCADE',
    keywords: ['undo', 'revert', 'rollback'],
  },
];

const NATURAL_LANGUAGE_HINTS = [
  'Move standup to 3pm',
  'Schedule a meeting tomorrow at 2pm',
  'What\'s on my calendar?',
  'Reschedule the design sync',
  'Create a focus block for deep work',
];

export const CommandPalette = ({
  isOpen,
  onClose,
  onExecuteCommand,
  onNaturalLanguage,
  nodes = [],
  recentCommands = [],
  canUndo = false,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Build dynamic node commands
  const nodeCommands = useMemo(() => {
    return nodes.map(node => ({
      id: `node-${node.id}`,
      label: node.title,
      description: `${node.node_type} • ${node.start_time ? new Date(node.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'No time'}`,
      icon: node.node_type === 'calendar_event' ? <FaCalendarAlt /> : <FaTasks />,
      category: 'nodes',
      action: 'SELECT_NODE',
      payload: node,
      keywords: [node.title.toLowerCase(), node.node_type],
    }));
  }, [nodes]);

  // Filter commands based on query
  const filteredCommands = useMemo(() => {
    const allCommands = [
      ...STATIC_COMMANDS.filter(cmd => cmd.id !== 'undo-cascade' || canUndo),
      ...nodeCommands,
    ];

    if (!query.trim()) {
      // Show recent + static commands when empty
      const recent = recentCommands.slice(0, 3).map(cmd => ({
        ...cmd,
        category: 'recent',
        icon: <FaHistory />,
      }));
      return [...recent, ...STATIC_COMMANDS.filter(cmd => cmd.id !== 'undo-cascade' || canUndo)];
    }

    const lowerQuery = query.toLowerCase();
    
    return allCommands
      .filter(cmd => {
        const matchLabel = cmd.label.toLowerCase().includes(lowerQuery);
        const matchDesc = cmd.description?.toLowerCase().includes(lowerQuery);
        const matchKeywords = cmd.keywords?.some(kw => kw.includes(lowerQuery));
        return matchLabel || matchDesc || matchKeywords;
      })
      .slice(0, 10);
  }, [query, nodeCommands, recentCommands, canUndo]);

  // Check if query looks like natural language
  const looksLikeNaturalLanguage = useMemo(() => {
    if (!query.trim()) return false;
    const nlPatterns = [
      /^(move|schedule|create|add|reschedule|cancel|what|show|list)/i,
      /\b(to|at|for|tomorrow|today|next)\b/i,
      /\d{1,2}(:\d{2})?\s*(am|pm)/i,
    ];
    return nlPatterns.some(pattern => pattern.test(query));
  }, [query]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => 
          Math.min(prev + 1, (looksLikeNaturalLanguage ? 1 : filteredCommands.length) - 1)
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (looksLikeNaturalLanguage && selectedIndex === 0) {
          // Execute as natural language
          onNaturalLanguage(query);
          onClose();
        } else {
          const adjustedIndex = looksLikeNaturalLanguage ? selectedIndex - 1 : selectedIndex;
          const selected = filteredCommands[adjustedIndex];
          if (selected) {
            onExecuteCommand(selected);
            onClose();
          }
        }
        break;
      case 'Escape':
        onClose();
        break;
      case 'Tab':
        e.preventDefault();
        break;
    }
  }, [filteredCommands, selectedIndex, looksLikeNaturalLanguage, query, onExecuteCommand, onNaturalLanguage, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selected = listRef.current.querySelector('.command-item.selected');
      if (selected) {
        selected.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={e => e.stopPropagation()}>
        {/* Search Input */}
        <div className="command-input-wrapper">
          <FaSearch className="command-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="command-input"
            placeholder="Search or type a command..."
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
          />
          <div className="command-shortcuts">
            <kbd>↑↓</kbd> navigate
            <kbd>↵</kbd> select
            <kbd>esc</kbd> close
          </div>
        </div>

        {/* Natural Language Option */}
        {looksLikeNaturalLanguage && query.trim() && (
          <div className="command-nl-option">
            <button
              className={`command-item nl-item ${selectedIndex === 0 ? 'selected' : ''}`}
              onClick={() => {
                onNaturalLanguage(query);
                onClose();
              }}
              onMouseEnter={() => setSelectedIndex(0)}
            >
              <FaMagic className="command-item-icon nl-icon" />
              <div className="command-item-content">
                <span className="command-item-label">Ask AI: "{query}"</span>
                <span className="command-item-desc">Execute as natural language command</span>
              </div>
              <FaArrowRight className="command-item-arrow" />
            </button>
          </div>
        )}

        {/* Command List */}
        <div className="command-list" ref={listRef}>
          {filteredCommands.length === 0 && !looksLikeNaturalLanguage && (
            <div className="command-empty">
              <p>No matching commands</p>
              <p className="command-empty-hint">Try a natural language command like:</p>
              <div className="command-hints">
                {NATURAL_LANGUAGE_HINTS.slice(0, 3).map((hint, i) => (
                  <button 
                    key={i} 
                    className="command-hint-btn"
                    onClick={() => {
                      setQuery(hint);
                      setSelectedIndex(0);
                    }}
                  >
                    "{hint}"
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Group by category */}
          {['recent', 'actions', 'nodes'].map(category => {
            const categoryCommands = filteredCommands.filter(c => c.category === category);
            if (categoryCommands.length === 0) return null;

            const categoryLabels = {
              recent: 'Recent',
              actions: 'Actions',
              nodes: 'Nodes',
            };

            return (
              <div key={category} className="command-category">
                <div className="command-category-label">{categoryLabels[category]}</div>
                {categoryCommands.map((cmd) => {
                  const globalIndex = filteredCommands.indexOf(cmd) + (looksLikeNaturalLanguage ? 1 : 0);
                  return (
                    <button
                      key={cmd.id}
                      className={`command-item ${selectedIndex === globalIndex ? 'selected' : ''}`}
                      onClick={() => {
                        onExecuteCommand(cmd);
                        onClose();
                      }}
                      onMouseEnter={() => setSelectedIndex(globalIndex)}
                    >
                      <span className="command-item-icon">{cmd.icon}</span>
                      <div className="command-item-content">
                        <span className="command-item-label">{cmd.label}</span>
                        {cmd.description && (
                          <span className="command-item-desc">{cmd.description}</span>
                        )}
                      </div>
                      {cmd.action === 'SELECT_NODE' && (
                        <span className="command-item-badge">Click to select</span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="command-footer">
          <span className="command-footer-hint">
            <FaKeyboard style={{ marginRight: 4 }} />
            Pro tip: Type naturally like "move standup to 3pm"
          </span>
        </div>
      </div>
    </div>
  );
};
