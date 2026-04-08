import React, { useState, useCallback } from 'react';
import { 
  FaArrowRight, FaArrowLeft, FaRocket,
  FaCalendarAlt, FaBrain, FaMagic, FaCheck,
  FaKeyboard, FaMousePointer
} from 'react-icons/fa';

const ONBOARDING_STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to CASCADE',
    subtitle: 'The Ripple-Effect Workflow Engine',
    content: (
      <div className="onboarding-welcome">
        <div className="welcome-icon">⚡</div>
        <p>
          CASCADE intelligently manages schedule changes and their downstream effects.
          When one thing moves, everything connected adjusts automatically.
        </p>
        <div className="feature-highlights">
          <div className="feature-item">
            <FaBrain className="feature-icon" />
            <span>AI-Powered Conflict Resolution</span>
          </div>
          <div className="feature-item">
            <FaCalendarAlt className="feature-icon" />
            <span>Real Calendar Integration</span>
          </div>
          <div className="feature-item">
            <FaMagic className="feature-icon" />
            <span>Natural Language Commands</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'dag',
    title: 'Your Dependency Graph',
    subtitle: 'Visualize connections between tasks',
    content: (
      <div className="onboarding-dag">
        <div className="dag-illustration">
          <div className="dag-node trigger">Standup</div>
          <div className="dag-arrow">→</div>
          <div className="dag-node affected">Spec Review</div>
          <div className="dag-arrow">→</div>
          <div className="dag-node affected">Design Sync</div>
        </div>
        <p>
          Each node represents a task or event. Edges show dependencies.
          When a parent node moves, CASCADE automatically adjusts all connected children.
        </p>
        <div className="tip-box">
          <strong>💡 Tip:</strong> Drag any node to see a preview of how changes ripple through your schedule.
        </div>
      </div>
    ),
  },
  {
    id: 'interactions',
    title: 'Interact with Your Schedule',
    subtitle: 'Multiple ways to make changes',
    content: (
      <div className="onboarding-interactions">
        <div className="interaction-grid">
          <div className="interaction-card">
            <FaMousePointer className="interaction-icon" />
            <h4>Drag & Drop</h4>
            <p>Drag nodes to reschedule. See ripple effects before committing.</p>
          </div>
          <div className="interaction-card">
            <FaKeyboard className="interaction-icon" />
            <h4>Command Palette</h4>
            <p>Press <kbd>⌘K</kbd> or <kbd>Ctrl+K</kbd> for quick actions.</p>
          </div>
          <div className="interaction-card">
            <FaMagic className="interaction-icon" />
            <h4>Natural Language</h4>
            <p>Type "move standup to 3pm" in the command bar.</p>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'conflicts',
    title: 'Smart Conflict Resolution',
    subtitle: 'AI helps when things collide',
    content: (
      <div className="onboarding-conflicts">
        <div className="conflict-demo">
          <div className="conflict-scenario">
            <span className="conflict-label">⚠️ Deadline at 5:00 PM</span>
            <span className="conflict-arrow">←</span>
            <span className="conflict-label">Task pushed to 5:30 PM</span>
          </div>
        </div>
        <p>
          When a change causes conflicts (like missed deadlines), CASCADE's AI 
          generates resolution options ranked by impact.
        </p>
        <div className="resolution-preview">
          <div className="resolution-option-preview">
            <span className="option-rank">1</span>
            <span>Move deadline to 6:00 PM</span>
            <span className="option-impact low">Low impact</span>
          </div>
          <div className="resolution-option-preview">
            <span className="option-rank">2</span>
            <span>Split task into two parts</span>
            <span className="option-impact medium">Medium impact</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'ready',
    title: "You're Ready!",
    subtitle: 'Start managing your schedule intelligently',
    content: (
      <div className="onboarding-ready">
        <div className="ready-icon">
          <FaRocket />
        </div>
        <p>
          Click "Get Started" to seed demo data and explore CASCADE,
          or connect your Google Calendar to use real events.
        </p>
        <div className="quick-actions">
          <div className="quick-action">
            <FaCheck className="quick-action-icon" />
            <span>Demo data will be loaded automatically</span>
          </div>
          <div className="quick-action">
            <FaCheck className="quick-action-icon" />
            <span>Try dragging a node to see cascade preview</span>
          </div>
          <div className="quick-action">
            <FaCheck className="quick-action-icon" />
            <span>Use ⌘K to open the command palette</span>
          </div>
        </div>
      </div>
    ),
  },
];

export const OnboardingModal = ({
  isOpen,
  onComplete,
}) => {
  const [currentStep, setCurrentStep] = useState(0);

  const handleNext = useCallback(() => {
    if (currentStep < ONBOARDING_STEPS.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      onComplete();
    }
  }, [currentStep, onComplete]);

  const handlePrev = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  }, [currentStep]);

  const handleSkip = useCallback(() => {
    onComplete();
  }, [onComplete]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowRight' || e.key === 'Enter') {
      handleNext();
    } else if (e.key === 'ArrowLeft') {
      handlePrev();
    } else if (e.key === 'Escape') {
      handleSkip();
    }
  }, [handleNext, handlePrev, handleSkip]);

  if (!isOpen) return null;

  const step = ONBOARDING_STEPS[currentStep];
  const isLastStep = currentStep === ONBOARDING_STEPS.length - 1;

  return (
    <div 
      className="modal-overlay onboarding-overlay" 
      onClick={handleSkip}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal-content onboarding-modal" onClick={e => e.stopPropagation()}>
        {/* Progress Dots */}
        <div className="onboarding-progress">
          {ONBOARDING_STEPS.map((_, index) => (
            <button
              key={index}
              className={`progress-dot ${index === currentStep ? 'active' : ''} ${index < currentStep ? 'completed' : ''}`}
              onClick={() => setCurrentStep(index)}
              aria-label={`Go to step ${index + 1}`}
            />
          ))}
        </div>

        {/* Close Button */}
        <button className="onboarding-skip" onClick={handleSkip}>
          Skip intro
        </button>

        {/* Step Content */}
        <div className="onboarding-content">
          <h2 className="onboarding-title">{step.title}</h2>
          <p className="onboarding-subtitle">{step.subtitle}</p>
          <div className="onboarding-body">
            {step.content}
          </div>
        </div>

        {/* Navigation */}
        <div className="onboarding-nav">
          <button
            className="btn-secondary"
            onClick={handlePrev}
            disabled={currentStep === 0}
            style={{ visibility: currentStep === 0 ? 'hidden' : 'visible' }}
          >
            <FaArrowLeft style={{ marginRight: 6 }} />
            Back
          </button>
          
          <span className="step-indicator">
            {currentStep + 1} / {ONBOARDING_STEPS.length}
          </span>

          <button
            className="btn-primary"
            onClick={handleNext}
          >
            {isLastStep ? (
              <>
                <FaRocket style={{ marginRight: 6 }} />
                Get Started
              </>
            ) : (
              <>
                Next
                <FaArrowRight style={{ marginLeft: 6 }} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
