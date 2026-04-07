"""CASCADE — Main LangGraph Orchestrator and Agents."""
import os
import json
from typing import TypedDict, Annotated, List, Dict, Any
from langgraph.graph import StateGraph, END
from backend.routes.events import push_agent_event
import google.generativeai as genai
from backend.config import GEMINI_API_KEY

genai.configure(api_key=GEMINI_API_KEY)

class SystemState(TypedDict):
    trigger_prompt: str             # e.g. "Move the standup to 2 PM"
    parsed_intent: Dict[str, Any]   # LLM output parsed intent
    affected_nodes: List[Dict[str, Any]]
    final_response: str
    
async def parse_intent_node(state: SystemState):
    """Uses Gemini to figure out what the user wants to do."""
    await push_agent_event("Orchestrator", "Thinking", "Analyzing trigger prompt...")
    
    prompt = f"""
    You are an AI orchestrator for a dependency-aware productivity tool.
    Extract the intent from the following user command:
    "{state['trigger_prompt']}"
    
    Return a JSON object with:
    - action: "move", "cancel", "create"
    - target: the name of the meeting or task affected
    - new_time: any mentioned time
    """
    
    model = genai.GenerativeModel('gemini-flash-latest')
    response = model.generate_content(prompt)
    
    try:
        # crude json extraction 
        text = response.text.strip()
        if text.startswith("```json"):
            text = text[7:-3]
        intent = json.loads(text)
    except:
        intent = {"action": "unknown", "raw": response.text}
        
    await push_agent_event("Orchestrator", "Parsed Intent", f"Determined action: {intent.get('action')}")
    
    return {"parsed_intent": intent}
    
async def call_calendar_agent(state: SystemState):
    """Simulates/Real call to Calendar to get/update events."""
    await push_agent_event("Calendar Agent", "Action", f"Handling calendar update for: {state['parsed_intent'].get('target')}")
    # In full MCP, this would call the Calendar server
    return state

async def call_task_agent(state: SystemState):
    """Updates tasks based on cascade logic (simulated by dag_engine though)."""
    await push_agent_event("Task Agent", "Action", "Reviewing downstream task priorities.")
    return state
    
async def generate_final_summary(state: SystemState):
    """Produces the final text response."""
    await push_agent_event("Notes Agent", "Logging", "Commiting the cascade resolution note to DB.")
    return {"final_response": "Cascade handled successfully."}

def build_graph():
    workflow = StateGraph(SystemState)
    
    workflow.add_node("parse_intent", parse_intent_node)
    workflow.add_node("calendar_handle", call_calendar_agent)
    workflow.add_node("task_handle", call_task_agent)
    workflow.add_node("summarize", generate_final_summary)
    
    workflow.set_entry_point("parse_intent")
    workflow.add_edge("parse_intent", "calendar_handle")
    workflow.add_edge("calendar_handle", "task_handle")
    workflow.add_edge("task_handle", "summarize")
    workflow.add_edge("summarize", END)
    
    return workflow.compile()

graph_app = build_graph()
