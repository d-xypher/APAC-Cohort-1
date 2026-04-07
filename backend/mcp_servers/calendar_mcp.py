import os
import datetime
from pathlib import Path
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from mcp.server.fastmcp import FastMCP
from backend.config import GOOGLE_CREDENTIALS_PATH, GOOGLE_TOKEN_PATH

# Define Google Calendar API scopes
SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly']

mcp_cal = FastMCP("Google Calendar MCP Server")


def _resolve_path(path_value: str) -> Path:
    """Resolve relative paths from repository root for stable local execution."""
    path = Path(path_value)
    if path.is_absolute():
        return path
    repo_root = Path(__file__).resolve().parents[2]
    return repo_root / path

def get_calendar_service():
    """Gets Google Calendar API service instance (real OAuth)."""
    creds = None
    credentials_path = _resolve_path(GOOGLE_CREDENTIALS_PATH)
    token_path = _resolve_path(GOOGLE_TOKEN_PATH)

    # We will use token.json to store the user's access and refresh tokens.
    if token_path.exists():
        creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)
    
    # If there are no (valid) credentials available, let the user log in.
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not credentials_path.exists():
                raise FileNotFoundError(
                    "Missing Google OAuth credentials file. "
                    f"Expected at: {credentials_path}. "
                    "Create a Desktop OAuth client, enable Google Calendar API, "
                    "and place the downloaded JSON at that location."
                )
            flow = InstalledAppFlow.from_client_secrets_file(
                str(credentials_path), SCOPES
            )
            creds = flow.run_local_server(port=0)
        # Save the credentials for the next run
        token_path.parent.mkdir(parents=True, exist_ok=True)
        with open(token_path, 'w', encoding='utf-8') as token:
            token.write(creds.to_json())

    return build('calendar', 'v3', credentials=creds)

@mcp_cal.tool()
def get_upcoming_events(max_results: int = 10) -> str:
    """Lists upcoming events on the user's primary calendar."""
    try:
        service = get_calendar_service()
        now = datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')
        events_result = service.events().list(calendarId='primary', timeMin=now,
                                              maxResults=max_results, singleEvents=True,
                                              orderBy='startTime').execute()
        events = events_result.get('items', [])
        
        if not events:
            return "No upcoming events found."
            
        res = "Upcoming Events:\n"
        for event in events:
            start = event['start'].get('dateTime', event['start'].get('date'))
            summary = event.get('summary', '(No title)')
            res += f"- {summary} (Start: {start}) [ID: {event['id']}]\n"
        return res
    except HttpError as e:
        status = getattr(e.resp, 'status', None)
        if status in (401, 403):
            return (
                "Google Calendar auth failed. Verify Calendar API is enabled, "
                "OAuth app type is Desktop, and localhost redirect is allowed. "
                f"Details: {str(e)}"
            )
        return f"Google Calendar API error: {str(e)}"
    except Exception as e:
        return f"Error contacting Google Calendar: {str(e)}"

@mcp_cal.tool()
def reschedule_event(event_id: str, new_start_datetime_iso: str, new_end_datetime_iso: str) -> str:
    """Moves a calendar event to a new time."""
    try:
        service = get_calendar_service()
        event = service.events().get(calendarId='primary', eventId=event_id).execute()
        
        event['start']['dateTime'] = new_start_datetime_iso
        event['end']['dateTime'] = new_end_datetime_iso
        
        updated_event = service.events().update(calendarId='primary', eventId=event_id, body=event).execute()
        return f"Successfully updated event '{updated_event['summary']}' to start at {new_start_datetime_iso}"
    except Exception as e:
        return f"Error updating event: {str(e)}"

if __name__ == "__main__":
    # Provides stdio mapping for MCP protocol
    mcp_cal.run()
