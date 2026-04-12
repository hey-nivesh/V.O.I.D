import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useSSE } from '../hooks/useSSE';
import { ticketsAPI, type Ticket, type TicketStatus } from '../api/client';
import MainLayout from '../components/Layout/MainLayout';
import MainFeed from '../components/Layout/MainFeed';

export default function DashboardPage() {
    const { } = useAuth();
    const navigate = useNavigate();
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    // Cast initial state to match TicketStatus | 'ALL'
    const [filter, setFilter] = useState<TicketStatus | 'ALL'>('ALL');

    const fetchTickets = useCallback(async () => {
        const queryFilter = filter === 'ALL' ? undefined : filter;
        const response = await ticketsAPI.list(queryFilter);
        if (response.success && response.data) {
            setTickets(response.data.tickets);
        }
        setIsLoading(false);
    }, [filter]);

    // Handle SSE events
    const handleSSEEvent = useCallback((event: { type: string; payload: Record<string, unknown> }) => {
        if (event.type.startsWith('ticket.')) {
            fetchTickets();
        }
        if (event.type === 'push_approval.changed') {
            window.dispatchEvent(new CustomEvent('void-push-approval-changed', { detail: event.payload }));
            fetchTickets();
        }
    }, [fetchTickets]);

    useSSE(handleSSEEvent);

    useEffect(() => {
        fetchTickets();
    }, [fetchTickets]);

    return (
        <MainLayout>
            {isLoading ? (
                <div className="flex h-screen items-center justify-center">
                    <div className="w-8 h-8 border-4 border-[--color-accent] border-t-transparent rounded-full animate-spin"></div>
                </div>
            ) : (
                <MainFeed
                    tickets={tickets}
                    onSelectTicket={(id) => navigate(`/tickets/${id}`)}
                    statusFilter={filter}
                    setStatusFilter={setFilter}
                />
            )}
        </MainLayout>
    );
}
