import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { GitBranch, ShieldCheck, XCircle, Loader2 } from 'lucide-react';
import { pushApprovalAPI, type PushApprovalState } from '../api/client';

/**
 * Shown to admins when the Engineering Orchestrator is waiting on v.o.i.d/approval.json (git push gate).
 */
export default function PushApprovalBanner() {
    const navigate = useNavigate();
    const [approval, setApproval] = useState<PushApprovalState | null>(null);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const load = useCallback(async () => {
        const res = await pushApprovalAPI.get();
        if (res.success && res.data) {
            setApproval(res.data.approval);
            setErr(null);
        }
    }, []);

    useEffect(() => {
        void load();
        const t = setInterval(() => void load(), 4000);
        const onSse = () => void load();
        window.addEventListener('void-push-approval-changed', onSse);
        return () => {
            clearInterval(t);
            window.removeEventListener('void-push-approval-changed', onSse);
        };
    }, [load]);

    const act = async (status: 'approved' | 'rejected') => {
        setLoading(true);
        setErr(null);
        const res = await pushApprovalAPI.setStatus(status);
        setLoading(false);
        if (res.success) {
            await load();
        } else {
            setErr(res.error || 'Request failed');
        }
    };

    if (!approval || approval.status !== 'pending') {
        return null;
    }

    return (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 px-5 py-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-amber-900 font-bold text-sm">
                        <ShieldCheck className="w-5 h-5 shrink-0 text-amber-600" />
                        Orchestrator: approve git push
                    </div>
                    <p className="mt-1 text-xs text-amber-900/80 leading-relaxed">
                        Verification passed. The fix agent is blocked until you approve pushing branch{' '}
                        <span className="font-mono font-semibold">{approval.branch ?? '(branch)'}</span>
                        {approval.ticketId ? (
                            <>
                                {' '}
                                for ticket{' '}
                                <button
                                    type="button"
                                    onClick={() => navigate(`/tickets/${approval.ticketId}`)}
                                    className="font-mono font-bold text-amber-950 underline decoration-amber-400 hover:decoration-amber-600"
                                >
                                    {approval.ticketId}
                                </button>
                            </>
                        ) : null}
                        .
                    </p>
                    {approval.summary ? (
                        <p className="mt-2 text-[11px] text-amber-800/90 line-clamp-2 font-mono bg-white/60 rounded-lg px-2 py-1 border border-amber-100">
                            {approval.summary}
                        </p>
                    ) : null}
                    <p className="mt-2 flex items-center gap-1 text-[10px] text-amber-700/80">
                        <GitBranch className="w-3 h-3" />
                        Matches <code className="bg-white/80 px-1 rounded">v.o.i.d/approval.json</code> — approving continues the pipeline (commit/push).
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                        type="button"
                        disabled={loading}
                        onClick={() => void act('approved')}
                        className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow hover:bg-emerald-700 disabled:opacity-50"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        Approve push
                    </button>
                    <button
                        type="button"
                        disabled={loading}
                        onClick={() => void act('rejected')}
                        className="inline-flex items-center gap-2 rounded-full border border-red-300 bg-white px-4 py-2 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                        <XCircle className="w-4 h-4" />
                        Reject
                    </button>
                </div>
            </div>
            {err ? <p className="mt-2 text-xs font-medium text-red-600">{err}</p> : null}
        </div>
    );
}
