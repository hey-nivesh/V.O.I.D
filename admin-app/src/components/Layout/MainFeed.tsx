import React, { useState } from 'react';
import type { Ticket, TicketStatus } from '../../api/client';
import { Search, Clock, AlertCircle, CheckCircle2, MoreHorizontal, ArrowRight, Terminal, TrendingUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface MainFeedProps {
    tickets?: Ticket[]; // Made optional to handle mock mode if needed
    onSelectTicket?: (id: string) => void;
    statusFilter?: TicketStatus | 'ALL';
    setStatusFilter?: (status: TicketStatus | 'ALL') => void;
}

const StatsCard = ({ title, value, icon: Icon, color, trend }: any) => (
    <div className="bg-white/70 backdrop-blur-xl p-6 rounded-2xl border border-white/50 shadow-sm hover:shadow-md transition-all group">
        <div className="flex justify-between items-start">
            <div>
                <p className="text-gray-500 text-sm font-medium mb-1">{title}</p>
                <h3 className="text-3xl font-bold text-gray-800 tracking-tight group-hover:scale-105 transition-transform origin-left">{value}</h3>
            </div>
            <div className={`p-3 rounded-xl ${color} bg-opacity-20`}>
                <Icon className={`w-6 h-6 ${color.replace('bg-', 'text-')}`} />
            </div>
        </div>
        {trend && (
            <div className="mt-4 flex items-center gap-2 text-xs font-medium text-green-600 bg-green-50 px-2 py-1 rounded-lg w-fit">
                <TrendingUp className="w-3 h-3" />
                {trend}
            </div>
        )}
    </div>
);

// Mock Data for Logs
const MOCK_LOGS = [
    { id: 1, type: 'INFO', msg: 'System integrity check passed', time: '10:42:01 AM' },
    { id: 2, type: 'WARN', msg: 'High latency detected on us-east-1', time: '10:42:05 AM' },
    { id: 3, type: 'SUCCESS', msg: 'Backup completed successfully (2.4GB)', time: '10:43:12 AM' },
    { id: 4, type: 'INFO', msg: 'User session verified: admin@void.corp', time: '10:44:00 AM' },
];

const LiveSystemLogs = () => (
    <div className="bg-[#1e1e1e]/90 backdrop-blur-xl rounded-2xl border border-white/20 shadow-lg overflow-hidden font-mono text-xs col-span-full">
        <div className="bg-white/5 px-4 py-2 border-b border-white/10 flex justify-between items-center text-gray-400">
            <div className="flex items-center gap-2">
                <Terminal className="w-3 h-3" />
                <span className="font-bold tracking-wide text-[10px] uppercase">Live System Logs</span>
            </div>
            <div className="flex gap-1.5">
                <div className="w-2 h-2 rounded-full bg-red-500/50"></div>
                <div className="w-2 h-2 rounded-full bg-yellow-500/50"></div>
                <div className="w-2 h-2 rounded-full bg-green-500/50"></div>
            </div>
        </div>
        <div className="p-4 space-y-2 max-h-[120px] overflow-y-auto custom-scrollbar">
            {MOCK_LOGS.map((log) => (
                <div key={log.id} className="flex gap-3 hover:bg-white/5 p-1 rounded transition-colors cursor-default">
                    <span className="text-gray-500 w-20 shrink-0">{log.time}</span>
                    <span className={`font-bold w-16 shrink-0 ${log.type === 'INFO' ? 'text-blue-400' :
                        log.type === 'WARN' ? 'text-yellow-400' :
                            log.type === 'SUCCESS' ? 'text-green-400' : 'text-gray-300'
                        }`}>{log.type}</span>
                    <span className="text-gray-300 truncate">{log.msg}</span>
                </div>
            ))}
            <div className="animate-pulse text-blue-500">_</div>
        </div>
    </div>
);

const MainFeed: React.FC<MainFeedProps> = ({ tickets = [], statusFilter = 'ALL', setStatusFilter }) => {
    const navigate = useNavigate();
    const [searchTerm, setSearchTerm] = useState('');

    // Use Mock tickets if no empty, or merge/filter
    // For now using MOCK_TICKETS as primary for display as per redesign request
    // In real app, we would use 'tickets' prop

    // Use real tickets from props, fall back to mock if empty only if strictly needed, but for now strict real data
    const displayTickets = tickets.length > 0 ? tickets : [];

    const filteredTickets = displayTickets.filter(t =>
        (statusFilter === 'ALL' || t.status === statusFilter) &&
        (t.title.toLowerCase().includes(searchTerm.toLowerCase()) || t.component.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    return (
        <div className="h-full overflow-y-auto pb-20 custom-scrollbar pr-2">
            {/* Greeting */}
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
                    Good Morning, Admin! <span className="animate-pulse">☀️</span>
                </h1>
                <p className="text-gray-600 mt-1">Here's what's happening in your system today.</p>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <StatsCard title="Total Tickets" value="5" icon={Clock} color="bg-blue-100 text-blue-600" trend="+12% this week" />
                <StatsCard title="Critical Issues" value="0" icon={AlertCircle} color="bg-red-100 text-red-600" />
                <StatsCard title="Resolved" value="1" icon={CheckCircle2} color="bg-green-100 text-green-600" trend="+3 today" />
            </div>

            {/* Live Logs Widget */}
            <div className="mb-8">
                <LiveSystemLogs />
            </div>

            {/* Filters & Search */}
            <div className="flex flex-col sm:flex-row gap-4 mb-6 sticky top-0 z-10 py-4 bg-white/0 backdrop-blur-sm rounded-xl transition-all">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input
                        type="text"
                        placeholder="Search tickets..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 rounded-xl border border-white/50 bg-white/60 backdrop-blur-md focus:outline-none focus:ring-2 focus:ring-blue-500/50 shadow-sm transition-all text-sm"
                    />
                </div>
                <div className="flex gap-2 overflow-x-auto pb-2 sm:pb-0">
                    {['ALL', 'PENDING', 'IN_PROGRESS', 'REVIEW_PENDING'].map((filter) => (
                        <button
                            key={filter}
                            onClick={() => setStatusFilter && setStatusFilter(filter as any)}
                            className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${statusFilter === filter
                                ? 'bg-gray-900 text-white shadow-lg shadow-gray-900/20'
                                : 'bg-white/60 hover:bg-white text-gray-600 border border-white/50'
                                }`}
                        >
                            {filter === 'ALL' ? 'All View' : filter}
                        </button>
                    ))}
                </div>
            </div>

            {/* Ticket Grid */}
            <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-6">
                {filteredTickets.map((ticket) => (
                    <div
                        key={ticket.id}
                        onClick={() => navigate(`/tickets/${ticket.id}`)}
                        className="group bg-white/70 backdrop-blur-xl p-6 rounded-2xl border border-white/50 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer relative overflow-hidden flex flex-col"
                    >
                        <div className="absolute top-0 left-0 w-1 h-full bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                        <div className="flex justify-between items-start mb-4">
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg shadow-inner ${ticket.priority === 'CRITICAL' ? 'bg-red-100 text-red-600' :
                                    ticket.priority === 'HIGH' ? 'bg-orange-100 text-orange-600' :
                                        'bg-blue-100 text-blue-600'
                                    }`}>
                                    {ticket.title.substring(0, 2).toUpperCase()}
                                </div>
                                <div>
                                    <div className="font-bold text-gray-900 text-sm line-clamp-1">{ticket.title.split(' ').slice(0, 2).join(' ')}...</div>
                                    <div className="text-[10px] text-gray-500 font-mono">@{ticket.id}</div>
                                </div>
                            </div>
                            <MoreHorizontal className="w-5 h-5 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>

                        <h3 className="font-semibold text-gray-800 mb-3 leading-snug line-clamp-2 min-h-[3rem]">
                            {ticket.title}
                        </h3>

                        <p className="text-gray-500 text-xs mb-6 line-clamp-3 leading-relaxed flex-1">
                            {ticket.description}
                        </p>

                        <div className="flex items-center justify-between pt-4 border-t border-gray-100/50 mt-auto">
                            <span className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider ${ticket.status === 'APPROVED_FOR_PROD' ? 'bg-green-100 text-green-700' :
                                ticket.status === 'PENDING' ? 'bg-yellow-100 text-yellow-700' :
                                    'bg-gray-100 text-gray-600'
                                }`}>
                                {ticket.status.replace('_', ' ')}
                            </span>
                            <div className="flex items-center gap-1 text-gray-900 font-bold text-xs group-hover:translate-x-1 transition-transform">
                                Details <ArrowRight className="w-3 h-3" />
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default MainFeed;
