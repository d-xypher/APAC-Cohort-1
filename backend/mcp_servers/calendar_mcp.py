import os
import datetime
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from mcp.server.fastmcp import FastMCP

# Define Google Calendar API scopes
SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly']

mcp_cal = FastMCP("Google Calendar MCP Server")

def get_calendar_service():
    """Gets Google Calendar API service instance (real OAuth)."""
    creds = None
    # We will use token.json to store the user's access and refresh tokens.
    if os.path.exists('token.json'):
        creds = Credentials.from_authorized_user_file('token.json', SCOPES)
    
    # If there are no (valid) credentials available, let the user log in.
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists("credentials.json"):
                raise FileNotFoundError("Missing google calendar credentials.json in backend directory!")
            flow = InstalledAppFlow.from_client_secrets_file(
                'credentials.json', SCOPES)
            creds = flow.run_local_server(port=0)
        # Save the credentials for the next run
        with open('token.json', 'w') as token:
            token.write(creds.to_json())

    return build('calendar', 'v3', credentials=creds)

@mcp_cal.tool()
def get_upcoming_events(max_results: int = 10) -> str:
    """Lists upcoming events on the user's primary calendar."""
    try:
        service = get_calendar_service()
        now = datetime.datetime.utcnow().isoformat() + 'Z'  # 'Z' indicates UTC time
        events_result = service.events().list(calendarId='primary', timeMin=now,
                                              maxResults=max_results, singleEvents=True,
                                              orderBy='startTime').execute()
        events = events_result.get('items', [])
        
        if not events:
            return "No upcoming events found."
            
        res = "Upcoming Events:\n"
        for event in events:
            start = event['start'].get('dateTime', event['start'].get('date'))
            res += f"- {event['summary']} (Start: {start}) [ID: {event['id']}]\n"
        return res
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
