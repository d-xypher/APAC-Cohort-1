from mcp.server.fastmcp import FastMCP
from backend.utils.datetime_utils import utc_now

mcp_notes = FastMCP("Notion MCP Server (Mocked)")

# In-memory store for mocked notes
MOCK_NOTES = []

@mcp_notes.tool()
def append_cascade_note(target_name: str, context: str) -> str:
    """Mock appending a note to a Notion log."""
    note = f"[{utc_now().isoformat()}] Adjusted '{target_name}': {context}"
    MOCK_NOTES.append(note)
    return f"Successfully logged note to Notion: {note}"

if __name__ == "__main__":
    mcp_notes.run()
