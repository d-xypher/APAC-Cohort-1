from mcp.server.fastmcp import FastMCP
import json

mcp_task = FastMCP("Todoist MCP Server (Mocked)")

# In-memory store for mocked tasks
MOCK_TASKS = [
    {"id": "t1", "content": "Spec Review: Cascade Feature", "priority": 1, "is_completed": False},
    {"id": "t2", "content": "Draft Launch Brief", "priority": 3, "is_completed": False}
]

@mcp_task.tool()
def list_tasks() -> str:
    """Lists current open tasks."""
    return json.dumps([t for t in MOCK_TASKS if not t['is_completed']], indent=2)

@mcp_task.tool()
def reschedule_task(task_id: str, new_description: str) -> str:
    """Mock updates a task."""
    for t in MOCK_TASKS:
        if t['id'] == task_id:
            t['content'] = new_description
            return f"Updated task {task_id} successfully."
    return f"Task {task_id} not found."

if __name__ == "__main__":
    mcp_task.run()
