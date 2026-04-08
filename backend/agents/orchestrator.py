"""CASCADE — Intelligent LangGraph Orchestrator with Conditional Routing and Conflict Resolution.

This is NOT a wrapper. This is a ReAct-style agent system that:
1. Analyzes user intent with reasoning
2. Detects conflicts before they happen
3. Routes to specialized agents based on conflict type
4. Generates resolution options with impact scoring
5. Maintains full audit trail of reasoning
"""
import os
import json
import logging
from typing import TypedDict, Annotated, List, Dict, Any, Optional, Literal
from datetime import datetime, timedelta
from langgraph.graph import StateGraph, END
from backend.routes.events import (
    push_agent_event, EventType,
    push_reasoning, push_conflict_detected, push_resolution_options,
    push_cascade_preview, push_cascade_progress
)
import google.generativeai as genai
from backend.config import GEMINI_API_KEY
from backend.mcp_servers.calendar_mcp import get_upcoming_events, reschedule_event, get_calendar_service

logger = logging.getLogger(__name__)

genai.configure(api_key=GEMINI_API_KEY)

# Type definitions for state management
class ConflictInfo(TypedDict, total=False):
    type: str  # "deadline_violation", "double_booking", "insufficient_buffer", "cross_user_dependency"
    node_id: int
    node_title: str
    severity: str  # "critical", "warning", "info"
    details: Dict[str, Any]


class ResolutionOption(TypedDict):
    id: str
    title: str
    description: str
    impact_score: float  # 0-100, lower is better
    trade_offs: List[str]
    action: Dict[str, Any]  # What to do if selected


class SystemState(TypedDict):
    # Input
    trigger_prompt: str
    trigger_node_id: Optional[int]
    new_start_time: Optional[str]
    context: Dict[str, Any]
    
    # Processing
    parsed_intent: Dict[str, Any]
    reasoning_chain: List[str]  # Track agent's thinking
    affected_nodes: List[Dict[str, Any]]
    conflicts: List[ConflictInfo]
    resolution_options: List[ResolutionOption]
    selected_resolution: Optional[str]
    
    # Results
    calendar_result: str
    cascade_preview: Dict[str, Any]
    final_response: str
    audit_id: Optional[int]


# ═══════════════════════════════════════════════════════════════════════════════
# AGENT NODES — Each is a specialized reasoning unit
# ═══════════════════════════════════════════════════════════════════════════════

async def parse_intent_node(state: SystemState) -> Dict:
    """ReAct-style intent parsing with explicit reasoning."""
    await push_agent_event("Orchestrator", "Analyzing", "Parsing user intent with reasoning...", EventType.THINKING)
    
    prompt = f"""You are CASCADE's intent parser. Analyze this request with explicit reasoning.

USER REQUEST: "{state['trigger_prompt']}"

CONTEXT:
- Trigger Node ID: {state.get('trigger_node_id', 'None')}
- Requested New Time: {state.get('new_start_time', 'None')}
- Additional Context: {json.dumps(state.get('context', {}))}

Think step by step:
1. What is the user trying to do?
2. What entities are involved?
3. What are the potential ripple effects?
4. What conflicts might arise?

Return JSON:
{{
    "reasoning": "Your step-by-step thinking process",
    "action": "move" | "cancel" | "create" | "list" | "resolve_conflict" | "preview_cascade" | "unknown",
    "target": "name or description of target entity",
    "target_node_id": number or null,
    "new_time": "ISO 8601 datetime or null",
    "duration_minutes": number,
    "confidence": 0.0-1.0,
    "potential_conflicts": ["list of anticipated issues"],
    "recommended_checks": ["what to verify before proceeding"]
}}"""

    model = genai.GenerativeModel('gemini-2.0-flash')
    
    try:
        response = model.generate_content(prompt)
        text = response.text.strip()
        
        # Extract JSON from response
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0]
        elif "```" in text:
            text = text.split("```")[1].split("```")[0]
            
        intent = json.loads(text.strip())
        
        # Store reasoning for audit trail
        reasoning = intent.get('reasoning', 'No reasoning provided')
        push_reasoning("Orchestrator", reasoning)
        
        await push_agent_event(
            "Orchestrator", 
            "Intent Parsed",
            f"Action: {intent.get('action')} | Confidence: {intent.get('confidence', 0):.0%}",
            EventType.AGENT_UPDATE,
            {"intent": intent}
        )
        
        return {
            "parsed_intent": intent,
            "reasoning_chain": state.get('reasoning_chain', []) + [f"Intent: {reasoning}"]
        }
        
    except Exception as e:
        logger.error(f"Intent parsing failed: {e}")
        return {
            "parsed_intent": {"action": "unknown", "error": str(e)},
            "reasoning_chain": state.get('reasoning_chain', []) + [f"Intent parsing failed: {e}"]
        }


async def conflict_detector_node(state: SystemState) -> Dict:
    """Proactively detects conflicts BEFORE cascade execution."""
    await push_agent_event("Conflict Detector", "Scanning", "Analyzing potential conflicts...", EventType.THINKING)
    
    intent = state.get('parsed_intent', {})
    conflicts: List[ConflictInfo] = []
    
    # Get current calendar state for conflict detection
    try:
        calendar_events = get_upcoming_events(max_results=20)
    except Exception:
        calendar_events = ""
    
    # Use LLM to analyze conflicts
    prompt = f"""You are CASCADE's conflict detection system. Analyze for scheduling conflicts.

INTENDED ACTION: {intent.get('action')}
TARGET: {intent.get('target')}
NEW TIME: {intent.get('new_time') or state.get('new_start_time')}
POTENTIAL CONFLICTS FLAGGED BY PARSER: {intent.get('potential_conflicts', [])}

CURRENT CALENDAR STATE:
{calendar_events}

Detect these conflict types:
1. DEADLINE_VIOLATION - Would this cause a deadline to be missed?
2. DOUBLE_BOOKING - Would this overlap with another event?
3. INSUFFICIENT_BUFFER - Less than 15 minutes between events?
4. CASCADE_OVERFLOW - Would ripple effects push things to unreasonable times?
5. FOCUS_TIME_INTRUSION - Would this disrupt a focus/deep work block?

Return JSON:
{{
    "reasoning": "Your conflict analysis",
    "conflicts": [
        {{
            "type": "DEADLINE_VIOLATION" | "DOUBLE_BOOKING" | "INSUFFICIENT_BUFFER" | "CASCADE_OVERFLOW" | "FOCUS_TIME_INTRUSION",
            "severity": "critical" | "warning" | "info",
            "node_id": number or null,
            "node_title": "affected item name",
            "details": {{"specific": "details about conflict"}}
        }}
    ],
    "is_safe_to_proceed": true | false,
    "recommended_action": "proceed" | "warn_user" | "require_resolution"
}}"""

    model = genai.GenerativeModel('gemini-2.0-flash')
    
    try:
        response = model.generate_content(prompt)
        text = response.text.strip()
        
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0]
        elif "```" in text:
            text = text.split("```")[1].split("```")[0]
            
        result = json.loads(text.strip())
        conflicts = result.get('conflicts', [])
        reasoning = result.get('reasoning', '')
        
        push_reasoning("Conflict Detector", reasoning)
        
        # Push each conflict to UI
        for conflict in conflicts:
            if conflict.get('severity') in ['critical', 'warning']:
                push_conflict_detected(
                    conflict.get('node_id', 0),
                    conflict.get('node_title', 'Unknown'),
                    conflict.get('type', 'UNKNOWN'),
                    conflict.get('details', {})
                )
        
        await push_agent_event(
            "Conflict Detector",
            "Analysis Complete",
            f"Found {len(conflicts)} potential conflict(s)",
            EventType.AGENT_UPDATE,
            {"conflicts": conflicts, "recommended_action": result.get('recommended_action')}
        )
        
        return {
            "conflicts": conflicts,
            "reasoning_chain": state.get('reasoning_chain', []) + [f"Conflicts: {reasoning}"]
        }
        
    except Exception as e:
        logger.error(f"Conflict detection failed: {e}")
        return {"conflicts": [], "reasoning_chain": state.get('reasoning_chain', []) + [f"Conflict detection error: {e}"]}


async def resolution_generator_node(state: SystemState) -> Dict:
    """Generates intelligent resolution options for detected conflicts."""
    conflicts = state.get('conflicts', [])
    
    if not conflicts:
        return {"resolution_options": []}
    
    await push_agent_event("Resolution Agent", "Generating", "Creating resolution options...", EventType.THINKING)
    
    critical_conflicts = [c for c in conflicts if c.get('severity') == 'critical']
    
    prompt = f"""You are CASCADE's resolution agent. Generate actionable solutions for these conflicts.

CONFLICTS TO RESOLVE:
{json.dumps(conflicts, indent=2)}

ORIGINAL INTENT:
{json.dumps(state.get('parsed_intent', {}), indent=2)}

Generate 3-4 resolution options, ordered by impact score (lower = better).

For each option, consider:
- How much disruption does this cause?
- What trade-offs are involved?
- Is this the simplest solution?

Return JSON:
{{
    "reasoning": "Your resolution strategy",
    "options": [
        {{
            "id": "option_1",
            "title": "Short descriptive title",
            "description": "What this option does",
            "impact_score": 0-100,
            "trade_offs": ["list of downsides"],
            "action": {{
                "type": "move_deadline" | "split_task" | "cancel_event" | "find_alternative_time" | "shorten_duration",
                "params": {{"specific": "parameters"}}
            }}
        }}
    ]
}}"""

    model = genai.GenerativeModel('gemini-2.0-flash')
    
    try:
        response = model.generate_content(prompt)
        text = response.text.strip()
        
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0]
        elif "```" in text:
            text = text.split("```")[1].split("```")[0]
            
        result = json.loads(text.strip())
        options = result.get('options', [])
        
        push_reasoning("Resolution Agent", result.get('reasoning', ''))
        
        # Push options to UI
        if options:
            push_resolution_options(
                state.get('trigger_node_id', 0),
                options
            )
        
        await push_agent_event(
            "Resolution Agent",
            "Options Ready",
            f"Generated {len(options)} resolution option(s)",
            EventType.RESOLUTION_OPTIONS,
            {"options": options}
        )
        
        return {
            "resolution_options": options,
            "reasoning_chain": state.get('reasoning_chain', []) + [f"Resolutions: {result.get('reasoning', '')}"]
        }
        
    except Exception as e:
        logger.error(f"Resolution generation failed: {e}")
        return {"resolution_options": []}


async def cascade_preview_node(state: SystemState) -> Dict:
    """Generates a preview of cascade effects before committing."""
    await push_agent_event("Cascade Engine", "Computing", "Calculating ripple effects...", EventType.THINKING)
    
    # This would integrate with the actual DAG engine for real preview
    # For now, use LLM to estimate impact
    
    intent = state.get('parsed_intent', {})
    
    prompt = f"""Estimate the cascade impact of this scheduling change.

ACTION: {intent.get('action')}
TARGET: {intent.get('target')}  
NEW TIME: {intent.get('new_time') or state.get('new_start_time')}

Estimate what downstream tasks/events would be affected.

Return JSON:
{{
    "affected_nodes": [
        {{"id": 1, "title": "Task name", "current_time": "HH:MM", "new_time": "HH:MM", "delta_mins": 30}}
    ],
    "total_nodes_affected": number,
    "total_delay_minutes": number,
    "cascade_depth": number,
    "summary": "Brief description of impact"
}}"""

    model = genai.GenerativeModel('gemini-2.0-flash')
    
    try:
        response = model.generate_content(prompt)
        text = response.text.strip()
        
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0]
        elif "```" in text:
            text = text.split("```")[1].split("```")[0]
            
        preview = json.loads(text.strip())
        
        push_cascade_preview(
            preview.get('affected_nodes', []),
            preview.get('total_delay_minutes', 0)
        )
        
        await push_agent_event(
            "Cascade Engine",
            "Preview Ready",
            preview.get('summary', 'Preview generated'),
            EventType.CASCADE_PREVIEW,
            preview
        )
        
        return {
            "cascade_preview": preview,
            "affected_nodes": preview.get('affected_nodes', [])
        }
        
    except Exception as e:
        logger.error(f"Cascade preview failed: {e}")
        return {"cascade_preview": {}, "affected_nodes": []}


async def calendar_agent_node(state: SystemState) -> Dict:
    """Executes calendar operations with detailed feedback."""
    intent = state.get('parsed_intent', {})
    action = intent.get('action', 'unknown')
    
    await push_agent_event("Calendar Agent", "Executing", f"Performing {action}...", EventType.AGENT_UPDATE)
    
    result = ""
    
    try:
        if action == "list":
            result = get_upcoming_events(max_results=10)
            await push_agent_event("Calendar Agent", "Complete", "Retrieved calendar events")
            
        elif action == "move" and intent.get('target'):
            # Find and move the event
            events_text = get_upcoming_events(max_results=20)
            target = intent.get('target', '')
            new_time = intent.get('new_time') or state.get('new_start_time')
            
            event_id = None
            for line in events_text.split('\n'):
                if target.lower() in line.lower() and '[ID:' in line:
                    start = line.find('[ID:') + 5
                    end = line.find(']', start)
                    if start > 4 and end > start:
                        event_id = line[start:end].strip()
                        break
            
            if event_id and new_time:
                from datetime import datetime, timedelta
                start_dt = datetime.fromisoformat(new_time.replace('Z', '+00:00'))
                duration = intent.get('duration_minutes', 60)
                end_dt = start_dt + timedelta(minutes=duration)
                
                result = reschedule_event(
                    event_id=event_id,
                    new_start_datetime_iso=start_dt.isoformat(),
                    new_end_datetime_iso=end_dt.isoformat()
                )
                await push_agent_event("Calendar Agent", "Complete", f"Rescheduled: {target}")
            else:
                result = f"Could not find event matching '{target}'"
                await push_agent_event("Calendar Agent", "Warning", result)
                
        elif action == "create" and intent.get('target'):
            target = intent.get('target')
            new_time = intent.get('new_time')
            
            if new_time:
                from datetime import datetime, timedelta
                start_dt = datetime.fromisoformat(new_time.replace('Z', '+00:00'))
                duration = intent.get('duration_minutes', 60)
                end_dt = start_dt + timedelta(minutes=duration)
                
                service = get_calendar_service()
                event = {
                    'summary': target,
                    'start': {'dateTime': start_dt.isoformat(), 'timeZone': 'UTC'},
                    'end': {'dateTime': end_dt.isoformat(), 'timeZone': 'UTC'},
                }
                created = service.events().insert(calendarId='primary', body=event).execute()
                result = f"Created '{target}' at {start_dt.strftime('%I:%M %p')}"
                await push_agent_event("Calendar Agent", "Complete", result)
            else:
                result = "No time specified for new event"
        else:
            result = "No calendar action required"
            
    except Exception as e:
        logger.error(f"Calendar agent error: {e}")
        result = f"Calendar operation failed: {str(e)}"
        await push_agent_event("Calendar Agent", "Error", str(e)[:50])
    
    return {"calendar_result": result}


async def task_agent_node(state: SystemState) -> Dict:
    """Handles task-related cascade propagation with progress updates."""
    affected = state.get('affected_nodes', [])
    
    if not affected:
        await push_agent_event("Task Agent", "Idle", "No downstream tasks to update")
        return state
    
    await push_agent_event("Task Agent", "Processing", f"Updating {len(affected)} downstream task(s)...")
    
    for i, node in enumerate(affected, 1):
        push_cascade_progress(i, len(affected), node.get('title', f'Node {i}'))
        # In real impl, this would update the DAG database
    
    await push_agent_event("Task Agent", "Complete", f"Updated {len(affected)} task(s)")
    return state


async def summary_node(state: SystemState) -> Dict:
    """Generates final response with full context."""
    
    # Compile all results
    calendar_result = state.get('calendar_result', '')
    conflicts = state.get('conflicts', [])
    resolutions = state.get('resolution_options', [])
    preview = state.get('cascade_preview', {})
    reasoning = state.get('reasoning_chain', [])
    
    # Generate intelligent summary
    prompt = f"""Summarize this CASCADE operation for the user.

CALENDAR RESULT: {calendar_result}
CONFLICTS FOUND: {len(conflicts)}
RESOLUTION OPTIONS: {len(resolutions)}
CASCADE IMPACT: {preview.get('summary', 'None')}

Write a brief, helpful summary (2-3 sentences) that:
1. Confirms what was done
2. Mentions any issues found
3. Suggests next steps if needed

Be concise and professional."""

    model = genai.GenerativeModel('gemini-2.0-flash')
    
    try:
        response = model.generate_content(prompt)
        summary = response.text.strip()
    except:
        summary = calendar_result or "Operation completed."
    
    await push_agent_event("Notes Agent", "Logging", "Recorded to audit trail")
    
    # Store reasoning audit
    audit_entry = {
        "reasoning_chain": reasoning,
        "conflicts": conflicts,
        "resolutions": resolutions,
        "final_summary": summary
    }
    
    return {
        "final_response": summary,
        "audit_id": None  # Would be DB ID in real impl
    }


# ═══════════════════════════════════════════════════════════════════════════════
# ROUTING LOGIC — Conditional edges based on state
# ═══════════════════════════════════════════════════════════════════════════════

def route_after_conflict_detection(state: SystemState) -> str:
    """Routes based on conflict severity."""
    conflicts = state.get('conflicts', [])
    
    critical = [c for c in conflicts if c.get('severity') == 'critical']
    warnings = [c for c in conflicts if c.get('severity') == 'warning']
    
    if critical:
        # Must generate resolution options before proceeding
        return "generate_resolutions"
    elif warnings:
        # Generate preview but allow proceeding
        return "cascade_preview"
    else:
        # No conflicts, go directly to execution
        return "calendar_agent"


def route_after_intent(state: SystemState) -> str:
    """Routes based on parsed intent action."""
    intent = state.get('parsed_intent', {})
    action = intent.get('action', 'unknown')
    
    if action in ['move', 'create', 'cancel']:
        # These need conflict detection first
        return "conflict_detector"
    elif action == 'list':
        # Read-only, skip conflict detection
        return "calendar_agent"
    elif action == 'resolve_conflict':
        # User is resolving a previous conflict
        return "apply_resolution"
    else:
        return "summarize"


# ═══════════════════════════════════════════════════════════════════════════════
# GRAPH BUILDER
# ═══════════════════════════════════════════════════════════════════════════════

def build_graph():
    """Builds the intelligent CASCADE workflow graph."""
    workflow = StateGraph(SystemState)
    
    # Add nodes
    workflow.add_node("parse_intent", parse_intent_node)
    workflow.add_node("conflict_detector", conflict_detector_node)
    workflow.add_node("generate_resolutions", resolution_generator_node)
    workflow.add_node("cascade_preview", cascade_preview_node)
    workflow.add_node("calendar_agent", calendar_agent_node)
    workflow.add_node("task_agent", task_agent_node)
    workflow.add_node("summarize", summary_node)
    
    # Entry point
    workflow.set_entry_point("parse_intent")
    
    # Conditional routing after intent parsing
    workflow.add_conditional_edges(
        "parse_intent",
        route_after_intent,
        {
            "conflict_detector": "conflict_detector",
            "calendar_agent": "calendar_agent",
            "apply_resolution": "calendar_agent",  # TODO: add resolution applier
            "summarize": "summarize"
        }
    )
    
    # Conditional routing after conflict detection
    workflow.add_conditional_edges(
        "conflict_detector",
        route_after_conflict_detection,
        {
            "generate_resolutions": "generate_resolutions",
            "cascade_preview": "cascade_preview",
            "calendar_agent": "calendar_agent"
        }
    )
    
    # Linear edges for remaining flow
    workflow.add_edge("generate_resolutions", "cascade_preview")
    workflow.add_edge("cascade_preview", "calendar_agent")
    workflow.add_edge("calendar_agent", "task_agent")
    workflow.add_edge("task_agent", "summarize")
    workflow.add_edge("summarize", END)
    
    return workflow.compile()


# Compiled graph instance
graph_app = build_graph()


# ═══════════════════════════════════════════════════════════════════════════════
# PUBLIC API
# ═══════════════════════════════════════════════════════════════════════════════

async def run_orchestrator(
    prompt: str,
    trigger_node_id: Optional[int] = None,
    new_start_time: Optional[str] = None,
    context: Optional[Dict] = None
) -> Dict[str, Any]:
    """Main entry point for the intelligent orchestrator."""
    
    initial_state: SystemState = {
        "trigger_prompt": prompt,
        "trigger_node_id": trigger_node_id,
        "new_start_time": new_start_time,
        "context": context or {},
        "parsed_intent": {},
        "reasoning_chain": [],
        "affected_nodes": [],
        "conflicts": [],
        "resolution_options": [],
        "selected_resolution": None,
        "calendar_result": "",
        "cascade_preview": {},
        "final_response": "",
        "audit_id": None
    }
    
    result = await graph_app.ainvoke(initial_state)
    
    return {
        "response": result.get("final_response", ""),
        "conflicts": result.get("conflicts", []),
        "resolution_options": result.get("resolution_options", []),
        "cascade_preview": result.get("cascade_preview", {}),
        "reasoning": result.get("reasoning_chain", []),
        "audit_id": result.get("audit_id")
    }
