import sys
import os

# Add the root 'cascade' directory to PYTHONPATH
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.mcp_servers.calendar_mcp import get_upcoming_events

if __name__ == "__main__":
    print("Testing Google Calendar Auth Flow...\n")
    print("If this is your first run, a browser window will open.")
    print("Please log in to your Google Account to authorize Cascade.\n")
    
    try:
        events = get_upcoming_events(max_results=5)
        print("✅ SUCCESS! Here are your upcoming events:\n")
        print(events)
        print("\n(Your session token has been automatically saved to token.json)")
    except Exception as e:
        print(f"❌ ERROR: {e}")
