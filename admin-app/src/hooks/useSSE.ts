import { useState, useEffect, useCallback, useRef } from 'react';
import { getToken } from '../api/client';

interface SSEEvent {
    type: string;
    payload: Record<string, unknown>;
    timestamp: string;
}

export function useSSE(onEvent?: (event: SSEEvent) => void) {
    const [events, setEvents] = useState<SSEEvent[]>([]);
    const [isConnected, setIsConnected] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const eventSourceRef = useRef<EventSource | null>(null);
    const reconnectTimeoutRef = useRef<number | null>(null);
    const onEventRef = useRef(onEvent);
    useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);

    const connect = useCallback(() => {
        const token = getToken();
        if (!token) {
            setError('No authentication token');
            return;
        }

        // Close existing connection
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
        }

        // Note: Standard EventSource doesn't support custom headers
        // We'll use a workaround by passing token as query param for demo
        // In production, use fetch-based SSE or a library like eventsource-polyfill
        const eventSource = new EventSource(`/api/events?token=${token}`);
        eventSourceRef.current = eventSource;

        eventSource.onopen = () => {
            console.log('SSE connected');
            setIsConnected(true);
            setError(null);
        };

        eventSource.onmessage = (event) => {
            try {
                const data: SSEEvent = JSON.parse(event.data);
                console.log('SSE event:', data);
                setEvents((prev) => [data, ...prev].slice(0, 50)); // Keep last 50 events
                onEvent?.(data);
            } catch (e) {
                console.error('Failed to parse SSE event:', e);
            }
        };

        eventSource.onerror = () => {
            console.log('SSE error, attempting reconnect...');
            setIsConnected(false);
            eventSource.close();

            // Reconnect after 3 seconds
            reconnectTimeoutRef.current = window.setTimeout(() => {
                connect();
            }, 3000);
        };
    }, [onEvent]);

    const disconnect = useCallback(() => {
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }
        setIsConnected(false);
    }, []);

    useEffect(() => {
        connect();
        return () => disconnect();
    }, [connect, disconnect]);

    return { events, isConnected, error, reconnect: connect };
}
