import { TicketPayload } from '../types';

// Connect to the real MCP Server
const MCP_API_URL = 'http://localhost:3000';

// Store token for authentication
let authToken: string | null = null;

// Login as voice agent
export const loginAsVoiceAgent = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${MCP_API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'voice', password: 'voicepass' })
    });

    const data = await response.json();
    if (data.success && data.data?.token) {
      authToken = data.data.token;
      console.log('[MCP Service] Logged in as voice agent');
      return true;
    }
    return false;
  } catch (error) {
    console.error('[MCP Service] Login failed:', error);
    return false;
  }
};

export const submitTicketToMCP = async (
  ticket: TicketPayload,
  isRetry = false
): Promise<{ success: boolean; ticket_id?: string; error?: string }> => {
  // Auto-login if no token
  if (!authToken) {
    const loggedIn = await loginAsVoiceAgent();
    if (!loggedIn) {
      return { success: false, error: 'Failed to authenticate with MCP server' };
    }
  }

  console.log('[MCP Service] Submitting ticket:', ticket);

  try {
    const response = await fetch(`${MCP_API_URL}/api/tickets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        title: ticket.title,
        description: ticket.description,
        component: ticket.component || 'Unknown',
        priority: ticket.priority,
        user_context: ticket.user_context
      })
    });

    const data = await response.json();

    if (data.success) {
      console.log('[MCP Service] Ticket created:', data.data.ticket_id);
      return {
        success: true,
        ticket_id: data.data.ticket_id
      };
    }

    if (response.status === 401 && !isRetry) {
      console.warn('[MCP Service] Token rejected — re-logging in and retrying once');
      authToken = null;
      return submitTicketToMCP(ticket, true);
    }

    return {
      success: false,
      error: data.error || 'Failed to create ticket'
    };
  } catch (error) {
    console.error('[MCP Service] Request failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error'
    };
  }
}


// Maintain SSE connection to show as "Online"
export const connectToSSEStream = async () => {
  if (!authToken) {
    const loggedIn = await loginAsVoiceAgent();
    if (!loggedIn) return;
  }

  // Use native EventSource with token in query param
  // This ensures a persistent connection that the server recognizes
  try {
    const eventSource = new EventSource(`${MCP_API_URL}/api/events?token=${authToken}`);

    eventSource.onopen = () => {
      console.log('[MCP Service] SSE Connected');
    };

    eventSource.onmessage = (event) => {
      // Keep connection alive and log events if needed
      // console.log('[MCP Service] SSE Event:', event.data);
    };

    eventSource.onerror = (error) => {
      console.error('[MCP Service] SSE Error:', error);
      eventSource.close();
      // Retry in 5s
      setTimeout(connectToSSEStream, 5000);
    };
  } catch (e) {
    console.log('SSE connection init failed', e);
    // Retry in 5s
    setTimeout(connectToSSEStream, 5000);
  }
};
