"""Chat endpoint with streaming Gemini responses and Calendar MCP integration."""
import json
import logging
from collections import defaultdict, deque
from threading import Lock
from time import time
from typing import Deque, Optional

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import google.generativeai as genai

from backend.config import GEMINI_API_KEY
from backend.routes.events import push_agent_event
from backend.mcp_servers.calendar_mcp import get_upcoming_events, reschedule_event, create_event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["chat"])

genai.configure(api_key=GEMINI_API_KEY)

RATE_LIMIT_WINDOW_SECONDS = 60
RATE_LIMIT_MAX_REQUESTS = 30
_rate_limit_buckets: dict[str, Deque[float]] = defaultdict(deque)
_rate_limit_lock = Lock()

# Define function declarations for Gemini function calling
CALENDAR_TOOLS = [
    {
        "name": "get_upcoming_events",
        "description": "Get a list of upcoming events from the user's Google Calendar. Use this when the user asks about their schedule, meetings, or upcoming events.",
        "parameters": {
            "type": "object",
            "properties": {
                "max_results": {
                    "type": "integer",
                    "description": "Maximum number of events to return (default: 10)"
                }
            },
            "required": []
        }
    },
    {
        "name": "reschedule_event",
        "description": "Move a calendar event to a new time. Use this when the user asks to reschedule, move, or change the time of a meeting.",
        "parameters": {
            "type": "object",
            "properties": {
                "event_id": {
                    "type": "string",
                    "description": "The ID of the event to reschedule"
                },
                "new_start_datetime_iso": {
                    "type": "string",
                    "description": "The new start time in ISO 8601 format (e.g., 2024-01-15T14:00:00-08:00)"
                },
                "new_end_datetime_iso": {
                    "type": "string",
                    "description": "The new end time in ISO 8601 format"
                }
            },
            "required": ["event_id", "new_start_datetime_iso", "new_end_datetime_iso"]
        }
    },
    {
        "name": "create_event",
        "description": "Create a new event on the user's Google Calendar. Use this when the user wants to schedule a new meeting or event.",
        "parameters": {
            "type": "object",
            "properties": {
                "summary": {
                    "type": "string",
                    "description": "Title of the event"
                },
                "start_datetime_iso": {
                    "type": "string",
                    "description": "Start time in ISO 8601 format"
                },
                "end_datetime_iso": {
                    "type": "string",
                    "description": "End time in ISO 8601 format"
                },
                "description": {
                    "type": "string",
                    "description": "Optional description for the event"
                }
            },
            "required": ["summary", "start_datetime_iso", "end_datetime_iso"]
        }
    }
]


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    context: Optional[str] = Field(default=None, max_length=4000)


class ChatResponse(BaseModel):
    response: str
    tool_calls: list = Field(default_factory=list)
    tool_results: list = Field(default_factory=list)


def _enforce_chat_rate_limit(client_ip: str) -> None:
    now = time()
    cutoff = now - RATE_LIMIT_WINDOW_SECONDS

    with _rate_limit_lock:
        bucket = _rate_limit_buckets[client_ip]
        while bucket and bucket[0] < cutoff:
            bucket.popleft()

        if len(bucket) >= RATE_LIMIT_MAX_REQUESTS:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded. Please retry shortly.",
            )

        bucket.append(now)


def execute_tool_call(function_name: str, args: dict) -> str:
    """Execute a tool call and return the result."""
    logger.info(f"Function Call: {function_name} with args: {args}")

    try:
        if function_name == "get_upcoming_events":
            max_results = args.get("max_results", 10)
            return get_upcoming_events(max_results)

        if function_name == "reschedule_event":
            return reschedule_event(
                event_id=args["event_id"],
                new_start_datetime_iso=args["new_start_datetime_iso"],
                new_end_datetime_iso=args["new_end_datetime_iso"]
            )

        if function_name == "create_event":
            return create_event(
                summary=args["summary"],
                start_datetime_iso=args["start_datetime_iso"],
                end_datetime_iso=args["end_datetime_iso"],
                description=args.get("description", "")
            )

        return f"Unknown function: {function_name}"
    except KeyError as exc:
        return f"Tool call missing required argument: {exc.args[0]}"
    except Exception as exc:
        return f"Tool call failed: {str(exc)}"


def _build_model_with_optional_tools(model_name: str = 'gemini-flash-latest'):
    """Create Gemini model and gracefully degrade if tool schema is unsupported."""
    try:
        return genai.GenerativeModel(model_name, tools=CALENDAR_TOOLS), True
    except Exception as exc:
        logger.warning("Tool-enabled Gemini model init failed; falling back to text-only mode: %s", exc)
        return genai.GenerativeModel(model_name), False


async def generate_streaming_response(message: str, context: Optional[str] = None):
    """Generator that yields SSE-formatted chunks from Gemini with function calling."""
    
    await push_agent_event("Chat Agent", "Thinking", f"Processing: {message[:50]}...")
    
    system_prompt = """You are CASCADE, an AI assistant for productivity and calendar management.
You have access to tools for managing the user's Google Calendar.

When the user asks about their schedule, use get_upcoming_events.
When they want to reschedule something, use reschedule_event.
When they want to create a new meeting, use create_event.

Be concise and helpful. After executing calendar operations, confirm what was done.
Current date/time context will be provided if available."""

    full_prompt = system_prompt
    if context:
        full_prompt += f"\n\nContext: {context}"
    full_prompt += f"\n\nUser: {message}"
    
    model, tools_enabled = _build_model_with_optional_tools('gemini-flash-latest')
    
    try:
        # Initial response - may contain function calls
        response = model.generate_content(full_prompt)
        
        tool_calls = []
        tool_results = []
        
        # Check if there are function calls in the response
        if tools_enabled and response.candidates and response.candidates[0].content.parts:
            for part in response.candidates[0].content.parts:
                if hasattr(part, 'function_call') and part.function_call:
                    fc = part.function_call
                    function_name = fc.name
                    args = dict(fc.args) if fc.args else {}
                    
                    await push_agent_event("Chat Agent", "Tool Call", f"Executing: {function_name}")
                    
                    # Execute the tool
                    result = execute_tool_call(function_name, args)
                    
                    tool_calls.append({
                        "name": function_name,
                        "args": args
                    })
                    tool_results.append({
                        "name": function_name,
                        "result": result
                    })
                    
                    await push_agent_event("Chat Agent", "Tool Result", result[:100])
                    
                    # Yield tool call info
                    yield f"data: {json.dumps({'type': 'tool_call', 'name': function_name, 'args': args})}\n\n"
                    yield f"data: {json.dumps({'type': 'tool_result', 'name': function_name, 'result': result})}\n\n"
        
        # If we had tool calls, get a follow-up response
        if tool_calls:
            # Build context with tool results
            follow_up_prompt = full_prompt + "\n\nTool results:\n"
            for tr in tool_results:
                follow_up_prompt += f"- {tr['name']}: {tr['result']}\n"
            follow_up_prompt += "\nNow provide a natural response summarizing what was done."
            
            # Get final response without tools
            final_model = genai.GenerativeModel('gemini-flash-latest')
            final_response = final_model.generate_content(follow_up_prompt)
            response_text = final_response.text if final_response.text else "Action completed successfully."
        else:
            # No tool calls, just get the text response
            response_text = response.text if response.text else "I'm not sure how to help with that."
        
        # Stream the response text in chunks for better UX
        chunk_size = 50
        for i in range(0, len(response_text), chunk_size):
            chunk = response_text[i:i + chunk_size]
            yield f"data: {json.dumps({'type': 'text', 'content': chunk})}\n\n"
        
        # Final done signal
        yield f"data: {json.dumps({'type': 'done', 'tool_calls': tool_calls, 'tool_results': tool_results})}\n\n"
        
        await push_agent_event("Chat Agent", "Complete", "Response delivered")
        
    except Exception as e:
        logger.error(f"Gemini API error: {e}")
        error_msg = f"Sorry, I encountered an error: {str(e)}"
        yield f"data: {json.dumps({'type': 'error', 'message': error_msg})}\n\n"
        await push_agent_event("Chat Agent", "Error", str(e)[:100])


@router.post("/stream")
async def chat_stream(http_request: Request, request: ChatRequest):
    """Stream chat responses from Gemini with function calling support."""
    client_ip = http_request.client.host if http_request.client else "unknown"
    _enforce_chat_rate_limit(client_ip)

    if not GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured")
    
    message = request.message.strip()
    context = request.context.strip() if request.context else None

    if not message:
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    
    return StreamingResponse(
        generate_streaming_response(message, context),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@router.post("/", response_model=ChatResponse)
async def chat(http_request: Request, request: ChatRequest):
    """Non-streaming chat endpoint for simpler integrations."""
    client_ip = http_request.client.host if http_request.client else "unknown"
    _enforce_chat_rate_limit(client_ip)

    if not GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY not configured")
    
    message = request.message.strip()
    context = request.context.strip() if request.context else None

    if not message:
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    
    await push_agent_event("Chat Agent", "Thinking", f"Processing: {message[:50]}...")
    
    system_prompt = """You are CASCADE, an AI assistant for productivity and calendar management.
You have access to tools for managing the user's Google Calendar.

When the user asks about their schedule, use get_upcoming_events.
When they want to reschedule something, use reschedule_event.
When they want to create a new meeting, use create_event.

Be concise and helpful. After executing calendar operations, confirm what was done."""

    full_prompt = system_prompt
    if context:
        full_prompt += f"\n\nContext: {context}"
    full_prompt += f"\n\nUser: {message}"
    
    model, tools_enabled = _build_model_with_optional_tools('gemini-flash-latest')
    
    try:
        response = model.generate_content(full_prompt)
        
        tool_calls = []
        tool_results = []
        
        # Process function calls
        if tools_enabled and response.candidates and response.candidates[0].content.parts:
            for part in response.candidates[0].content.parts:
                if hasattr(part, 'function_call') and part.function_call:
                    fc = part.function_call
                    function_name = fc.name
                    args = dict(fc.args) if fc.args else {}
                    
                    await push_agent_event("Chat Agent", "Tool Call", f"Executing: {function_name}")
                    
                    result = execute_tool_call(function_name, args)
                    
                    tool_calls.append({"name": function_name, "args": args})
                    tool_results.append({"name": function_name, "result": result})
                    
                    await push_agent_event("Chat Agent", "Tool Result", result[:100])
        
        # Get final response
        if tool_calls:
            follow_up_prompt = full_prompt + "\n\nTool results:\n"
            for tr in tool_results:
                follow_up_prompt += f"- {tr['name']}: {tr['result']}\n"
            follow_up_prompt += "\nNow provide a natural response summarizing what was done."
            
            final_model = genai.GenerativeModel('gemini-flash-latest')
            final_response = final_model.generate_content(follow_up_prompt)
            response_text = final_response.text if final_response.text else "Action completed."
        else:
            response_text = response.text if response.text else "I'm not sure how to help with that."
        
        await push_agent_event("Chat Agent", "Complete", "Response delivered")
        
        return ChatResponse(
            response=response_text,
            tool_calls=tool_calls,
            tool_results=tool_results
        )
        
    except Exception as e:
        logger.error(f"Gemini API error: {e}")
        raise HTTPException(status_code=502, detail=f"AI processing error: {str(e)}")
