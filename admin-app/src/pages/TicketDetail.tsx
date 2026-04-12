import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Editor } from '@monaco-editor/react';
import { useAuth } from '../hooks/useAuth';
import { ticketsAPI, type Ticket, diagnosisAPI, tunnelAPI } from '../api/client';
import MainLayout from '../components/Layout/MainLayout';
import { ArrowLeft, User, Bot, Code2, Activity, Cloud } from 'lucide-react';

export default function TicketDetailPage() {
    const { ticketId } = useParams<{ ticketId: string }>();
    const { user } = useAuth();
    const navigate = useNavigate();

    const [ticket, setTicket] = useState<Ticket | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState('');
    const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [pushGate, setPushGate] = useState<PushApprovalState | null>(null);

    // Reject modal state
    const [showRejectModal, setShowRejectModal] = useState(false);
    const [rejectReason, setRejectReason] = useState('');
    const [requestChanges, setRequestChanges] = useState(true);

    // Zone 3 & 6 state
    const [diagnosis, setDiagnosis] = useState<{ status: string, rca_report: any, patient_zero: { file: string, line: number } | null } | null>(null);
    const [tunnel, setTunnel] = useState<{ tunnel_url?: string, status: string, cloudflared_available: boolean } | null>(null);

    useEffect(() => {
        if (!ticketId) return;

        const fetchTicket = async () => {
            setIsLoading(true);
            const response = await ticketsAPI.get(ticketId);
            if (response.success && response.data) {
                setTicket(response.data.ticket);
                // Fetch Zone 3 & 6 data
                const diagRes = await diagnosisAPI.getReport(ticketId);
                if (diagRes.success && diagRes.data) {
                    setDiagnosis({
                        status: diagRes.data.diagnosis_status || 'PENDING',
                        rca_report: diagRes.data.rca_report,
                        patient_zero: diagRes.data.patient_zero
                    });
                }
                const tunnelRes = await tunnelAPI.getStatus(ticketId);
                if (tunnelRes.success && tunnelRes.data) {
                    setTunnel(tunnelRes.data.tunnel ? { 
                        ...tunnelRes.data.tunnel, 
                        cloudflared_available: tunnelRes.data.cloudflared_available 
                    } : null);
                }
            } else {
                setError(response.error || 'Failed to load ticket');
            }
            setIsLoading(false);
        };

        fetchTicket();
    }, [ticketId]);

    useEffect(() => {
        if (!ticketId || user?.role !== 'admin') return;
        const loadGate = async () => {
            const r = await pushApprovalAPI.get();
            if (r.success && r.data) {
                setPushGate(r.data.approval);
            }
        };
        void loadGate();
        if (ticket?.status !== 'IN_PROGRESS') {
            return;
        }
        const t = setInterval(() => void loadGate(), 4000);
        const onChanged = () => void loadGate();
        window.addEventListener('void-push-approval-changed', onChanged);
        return () => {
            clearInterval(t);
            window.removeEventListener('void-push-approval-changed', onChanged);
        };
    }, [ticketId, user?.role, ticket?.status]);

    const showToast = (type: 'success' | 'error', message: string) => {
        setToast({ type, message });
        setTimeout(() => setToast(null), 4000);
    };

    const handleStartDiagnosis = async () => {
        if (!ticket) return;
        setActionLoading(true);
        const res = await diagnosisAPI.start(ticket.id);
        if (res.success) {
            showToast('success', 'Diagnosis pipeline started!');
            setDiagnosis({ status: 'PENDING', rca_report: null, patient_zero: null });
        } else {
            showToast('error', res.error || 'Failed to start diagnosis');
        }
        setActionLoading(false);
    };

    const handleStartTunnel = async () => {
        if (!ticket) return;
        setActionLoading(true);
        // We'll pass 8080 as the local port to tunnel, but the API does it by default
        const res = await tunnelAPI.start(ticket.id);
        if (res.success && res.data) {
            showToast('success', 'Tunnel started successfully!');
            setTunnel({
                tunnel_url: res.data.tunnel_url,
                status: res.data.status,
                cloudflared_available: res.data.cloudflared_available
            });
            // Update ticket sandbox url
            setTicket(prev => prev ? { ...prev, sandbox_preview_url: res.data?.tunnel_url } : null);
        } else {
            showToast('error', res.error || 'Failed to start tunnel');
        }
        setActionLoading(false);
    };

    const handleApprove = async () => {
        if (!ticket || !user) return;
        setActionLoading(true);

        const response = await ticketsAPI.approve(ticket.id, user.username);

        if (response.success) {
            showToast('success', 'Ticket approved successfully!');
            // Refresh ticket
            const updated = await ticketsAPI.get(ticket.id);
            if (updated.success && updated.data) {
                setTicket(updated.data.ticket);
            }
        } else {
            showToast('error', response.error || 'Failed to approve');
        }
        setActionLoading(false);
    };

    const handleReject = async () => {
        if (!ticket || !rejectReason.trim()) return;
        setActionLoading(true);

        const response = await ticketsAPI.reject(ticket.id, rejectReason, requestChanges);

        if (response.success) {
            showToast('success', requestChanges ? 'Ticket sent back for changes' : 'Ticket closed');
            setShowRejectModal(false);
            // Refresh ticket
            const updated = await ticketsAPI.get(ticket.id);
            if (updated.success && updated.data) {
                setTicket(updated.data.ticket);
            }
        } else {
            showToast('error', response.error || 'Failed to reject');
        }
        setActionLoading(false);
    };

    const handlePushGate = async (status: 'approved' | 'rejected') => {
        setActionLoading(true);
        const res = await pushApprovalAPI.setStatus(status);
        if (res.success) {
            showToast('success', status === 'approved' ? 'Push approved — fix agent will continue.' : 'Push rejected.');
            const r = await pushApprovalAPI.get();
            if (r.success && r.data) setPushGate(r.data.approval);
        } else {
            showToast('error', res.error || 'Failed to update push approval');
        }
        setActionLoading(false);
    };

    if (isLoading) {
        return (
            <MainLayout showRightPanel={false}>
                <div className="flex h-full items-center justify-center">
                    <div className="p-8 text-center text-gray-500 bg-white/50 backdrop-blur-md rounded-2xl mx-4 mt-4 animate-pulse">
                        Loading ticket details...
                    </div>
                </div>
            </MainLayout>
        );
    }

    if (error && !ticket) {
        return (
            <MainLayout showRightPanel={false}>
                <div className="p-8 text-center text-red-500 bg-white/50 backdrop-blur-md rounded-2xl mx-4 mt-4">
                    {error || 'Ticket not found'}
                </div>
            </MainLayout>
        );
    }

    // Ensure ticket is not null for render
    if (!ticket) return null;

    return (
        <MainLayout showRightPanel={false}>
            <div className="h-full flex flex-col gap-6 overflow-y-auto pr-2 pb-20 custom-scrollbar">
                {/* Header / Title Section */}
                <div className="bg-white/90 backdrop-blur-xl p-6 rounded-2xl shadow-sm border border-white/50 transition-all hover:shadow-md">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <button
                                onClick={() => navigate('/')}
                                className="flex items-center gap-2 text-gray-500 hover:text-gray-900 mb-4 transition-colors font-medium text-sm group"
                            >
                                <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
                                Back to Dashboard
                            </button>
                            <h1 className="text-3xl font-bold text-gray-900 leading-tight">{ticket.title}</h1>
                            <div className="flex items-center gap-3 mt-4">
                                <span className={`px-3 py-1 rounded-full text-xs font-bold shadow-sm ${ticket.status === 'PENDING' ? 'bg-yellow-100 text-yellow-700' :
                                    ticket.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' :
                                        ticket.status === 'APPROVED_FOR_PROD' ? 'bg-green-100 text-green-700' :
                                            'bg-purple-100 text-purple-700'
                                    }`}>
                                    {ticket.status.replace('_', ' ')}
                                </span>
                                <span className={`px-3 py-1 rounded-full text-xs font-bold shadow-sm ${ticket.priority === 'CRITICAL' ? 'bg-red-100 text-red-700' :
                                    ticket.priority === 'HIGH' ? 'bg-orange-100 text-orange-700' :
                                        'bg-gray-100 text-gray-700'
                                    }`}>
                                    {ticket.priority}
                                </span>
                                <span className="text-gray-400 text-sm flex items-center gap-1">
                                    ticket #{ticket.id.substring(0, 8)}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="mt-6 flex flex-col gap-2 p-4 bg-gray-50/50 rounded-xl border border-gray-100 text-sm text-gray-600">
                        <p className="font-medium text-gray-900">Description</p>
                        <p className="leading-relaxed">{ticket.description || "No description provided."}</p>
                    </div>
                </div>

                {user?.role === 'admin' &&
                    pushGate?.status === 'pending' &&
                    pushGate.ticketId === ticket.id &&
                    ticket.status === 'IN_PROGRESS' && (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50/90 px-5 py-4 shadow-sm">
                            <p className="text-sm font-bold text-amber-900">Git push waiting for your approval</p>
                            <p className="mt-1 text-xs text-amber-800">
                                Orchestrator verified the build. Approve to let the fix agent commit and push branch{' '}
                                <span className="font-mono font-semibold">{pushGate.branch ?? 'fix/ticket-*'}</span>.
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    disabled={actionLoading}
                                    onClick={() => void handlePushGate('approved')}
                                    className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                                >
                                    Approve push
                                </button>
                                <button
                                    type="button"
                                    disabled={actionLoading}
                                    onClick={() => void handlePushGate('rejected')}
                                    className="rounded-full border border-red-300 bg-white px-4 py-2 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
                                >
                                    Reject
                                </button>
                            </div>
                        </div>
                    )}

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                    {/* Left Col: Context & Analysis */}
                    <div className="xl:col-span-1 flex flex-col gap-6">
                        {/* User Context */}
                        <div className="bg-white/90 backdrop-blur-xl p-5 rounded-2xl shadow-sm border border-white/50 flex-1 transition-all hover:shadow-md">
                            <div className="flex items-center gap-2 mb-4">
                                <User className="w-4 h-4 text-gray-400" />
                                <h3 className="font-bold text-gray-900">User Context</h3>
                            </div>
                            <div className="bg-gray-900 rounded-xl p-4 overflow-hidden shadow-inner border border-gray-800">
                                <pre className="text-xs font-mono text-gray-300 whitespace-pre-wrap overflow-x-auto custom-scrollbar h-[200px]">
                                    {ticket.user_context ? JSON.stringify(ticket.user_context, null, 2) : "No context available"}
                                </pre>
                            </div>
                        </div>

                        {/* AI Analysis */}
                        <div className="bg-white/90 backdrop-blur-xl p-5 rounded-2xl shadow-sm border border-white/50 flex-1 transition-all hover:shadow-md flex flex-col">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <Bot className="w-4 h-4 text-[--color-accent]" />
                                    <h3 className="font-bold text-gray-900">Diagnosis & RCA</h3>
                                </div>
                                {(ticket.status === 'PENDING' || ticket.status === 'IN_PROGRESS') && (
                                    <button 
                                        onClick={handleStartDiagnosis}
                                        disabled={actionLoading || diagnosis?.status === 'SANDBOXED' || diagnosis?.status === 'ANALYZING'}
                                        className="text-xs px-3 py-1 bg-blue-50 text-blue-600 font-bold rounded-lg hover:bg-blue-100 disabled:opacity-50 transition-colors"
                                    >
                                        Run Diagnosis
                                    </button>
                                )}
                            </div>
                            
                            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 max-h-[300px]">
                                {diagnosis?.status === 'COMPLETE' && diagnosis.rca_report ? (
                                    <div className="flex flex-col gap-3">
                                        <div className="bg-red-50 text-red-800 p-3 rounded-lg text-xs font-mono border border-red-100">
                                            <p className="font-bold mb-1 flex items-center gap-1">🚨 Patient Zero</p>
                                            {diagnosis.patient_zero?.file}:{diagnosis.patient_zero?.line}
                                        </div>
                                        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                                            {diagnosis.rca_report.diagnosis_summary}
                                        </p>
                                    </div>
                                ) : diagnosis?.status === 'FAILED' ? (
                                    <p className="text-sm text-red-500 italic">Diagnosis failed.</p>
                                ) : diagnosis?.status ? (
                                    <div className="flex items-center gap-2 text-sm text-blue-600 animate-pulse">
                                        <Activity className="w-4 h-4" />
                                        Pipeline Status: {diagnosis.status}
                                    </div>
                                ) : ticket.test_results?.logs ? (
                                    <p className="text-sm text-gray-600 leading-relaxed">
                                        {ticket.test_results.logs}
                                    </p>
                                ) : (
                                    <p className="text-sm text-gray-400 italic">No analysis available.</p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right Col: Code Editor */}
                    <div className="xl:col-span-2 flex flex-col h-[600px] bg-[#1e1e1e] rounded-2xl shadow-lg border border-gray-700/50 overflow-hidden font-mono text-sm">
                        {/* IDE Header */}
                        <div className="flex items-center justify-between px-4 py-2 bg-[#252526] border-b border-[#333333]">
                            <div className="flex items-center gap-0">
                                <div className="px-4 py-2 bg-[#1e1e1e] border-t-2 border-blue-500 text-gray-300 flex items-center gap-2 text-xs">
                                    <Code2 className="w-3 h-3 text-blue-400" />
                                    <span>suggested_fix.diff</span>
                                    <span className="ml-2 hover:bg-gray-700 rounded-full p-0.5 cursor-pointer">×</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full bg-yellow-500/20"></div>
                                <div className="w-3 h-3 rounded-full bg-green-500/20"></div>
                            </div>
                        </div>

                        <div className="flex-1 relative">
                            {ticket.diff ? (
                                <Editor
                                    height="100%"
                                    language="diff"
                                    value={ticket.diff}
                                    theme="vs-dark"
                                    options={{
                                        readOnly: true,
                                        minimap: { enabled: false },
                                        scrollBeyondLastLine: false,
                                        fontSize: 14,
                                        fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
                                        renderLineHighlight: 'all',
                                        smoothScrolling: true
                                    }}
                                />
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-4">
                                    <Bot className="w-12 h-12 opacity-20" />
                                    <p>AI is generating a fix...</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Tunnel Preview section */}
                <div className="bg-white/90 backdrop-blur-xl rounded-2xl shadow-sm border border-white/50 overflow-hidden mt-6 transition-all hover:shadow-md">
                    <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                        <span className="text-sm font-bold text-gray-800 flex items-center gap-2">
                            {tunnel?.status === 'active' ? (
                                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                            ) : (
                                <Cloud className="w-4 h-4 text-gray-400" />
                            )}
                            Live Environment Support
                        </span>
                        <div className="flex items-center gap-3">
                            {ticket.status === 'REVIEW_PENDING' && tunnel?.status !== 'active' && (
                                <button
                                    onClick={handleStartTunnel}
                                    disabled={actionLoading}
                                    className="text-xs px-3 py-1.5 bg-[--color-accent] text-white font-bold rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center gap-1 transition-opacity"
                                >
                                    <Cloud className="w-3 h-3" />
                                    Start Tunnel
                                </button>
                            )}
                            {(tunnel?.status === 'active' || ticket.sandbox_preview_url) && (
                                <a href={ticket.sandbox_preview_url || tunnel?.tunnel_url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline flex items-center gap-1 bg-blue-50 px-2 py-1 rounded">
                                    Open Fullscreen <span className="text-[10px]">↗</span>
                                </a>
                            )}
                        </div>
                    </div>
                    {tunnel?.status === 'active' || ticket.sandbox_preview_url ? (
                        <div className="relative w-full h-[500px] bg-white">
                            <iframe
                                src={ticket.sandbox_preview_url || tunnel?.tunnel_url}
                                className="w-full h-full border-0"
                                title="Preview"
                                sandbox="allow-scripts allow-same-origin allow-forms"
                            />
                        </div>
                    ) : (
                        <div className="h-[200px] flex flex-col items-center justify-center text-gray-500 text-sm bg-gray-50/50">
                            <Cloud className="w-8 h-8 mb-2 opacity-20" />
                            <span>No active tunnel. Start tunnel to preview changes.</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Action Buttons (Admin Only) */}
            {ticket.status === 'REVIEW_PENDING' && user?.role === 'admin' && (
                <div className="fixed bottom-0 left-0 right-0 lg:left-[350px] lg:right-[350px] bg-white/90 backdrop-blur-xl p-4 border-t border-gray-100 flex justify-end gap-3 shadow-lg rounded-t-2xl mx-4 lg:mx-0 z-50">
                    <button
                        onClick={() => setShowRejectModal(true)}
                        disabled={actionLoading}
                        className="px-5 py-2 rounded-full border border-red-300 text-red-600 hover:bg-red-50 transition-colors font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Reject
                    </button>
                    <button
                        onClick={handleApprove}
                        disabled={actionLoading}
                        className="px-5 py-2 rounded-full bg-emerald-500 text-white hover:bg-emerald-600 transition-colors font-bold text-sm shadow-md align-middle flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {actionLoading ? 'Processing...' : 'Approve & Deploy'}
                    </button>
                </div>
            )}

            {/* Modal */}
            {showRejectModal && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-100">
                        <h3 className="text-xl font-bold mb-4 text-gray-900">Reject Fix</h3>
                        <textarea
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl p-3 text-gray-800 placeholder-gray-400 focus:outline-none focus:border-blue-500 mb-4 text-sm resize-none"
                            rows={4}
                            placeholder="Reason for rejection..."
                        />
                        <div className="flex items-center gap-2 mb-6">
                            <input
                                type="checkbox"
                                id="reqChanges"
                                checked={requestChanges}
                                onChange={(e) => setRequestChanges(e.target.checked)}
                                className="rounded text-blue-600 focus:ring-blue-500"
                            />
                            <label htmlFor="reqChanges" className="text-gray-600 text-sm">Request changes from Agent</label>
                        </div>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setShowRejectModal(false)}
                                className="px-4 py-2 rounded-lg text-gray-500 hover:bg-gray-100 font-medium text-sm"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleReject}
                                disabled={!rejectReason.trim() || actionLoading}
                                className="px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {actionLoading ? 'Rejecting...' : 'Confirm Rejection'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast */}
            {toast && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 rounded-full bg-gray-900 text-white font-bold shadow-lg z-50 animate-fade-in-up">
                    {toast.message}
                </div>
            )}
        </MainLayout>
    );
}
