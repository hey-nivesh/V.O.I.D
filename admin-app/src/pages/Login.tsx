import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Sparkles, ArrowRight, Lock, User, Terminal } from 'lucide-react';

export default function LoginPage() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        // Simulate a "process" feel for feedback
        await new Promise(resolve => setTimeout(resolve, 800));

        const result = await login(username, password);

        if (result.success) {
            navigate('/dashboard');
        } else {
            setError(result.error || 'Login failed');
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen w-full flex items-center justify-center p-4 relative overflow-hidden bg-black font-sans text-white">
            {/* Dynamic Background Art */}
            <div className="absolute inset-0 bg-[#000000]">
                <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-purple-900/40 rounded-full blur-[120px] animate-pulse"></div>
                <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] bg-blue-900/20 rounded-full blur-[120px] delay-1000 animate-pulse"></div>
            </div>

            <div className="relative z-10 w-full max-w-[400px]">
                {/* Header */}
                <div className="text-center mb-10 space-y-2">
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 backdrop-blur-md mb-4 shadow-xl">
                        <Sparkles className="w-4 h-4 text-purple-400" />
                        <span className="text-xs font-medium tracking-wide text-gray-300">MCP CONTROL PLANE</span>
                    </div>
                    <h1 className="text-5xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-br from-white via-gray-200 to-gray-500 pb-2">
                        VOID
                    </h1>
                    <p className="text-gray-500 text-sm font-medium tracking-wide">AUTHENTICATION GATEWAY</p>
                </div>

                {/* Glass Card */}
                <div className="bg-white/5 backdrop-blur-2xl border border-white/10 rounded-3xl p-8 shadow-2xl relative overflow-hidden group hover:border-white/20 transition-colors">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 via-blue-500 to-cyan-500 opacity-50"></div>

                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Identity</label>
                            <div className="relative">
                                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500 transition-colors group-focus-within:text-white" />
                                <input
                                    type="text"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    className="w-full bg-black/40 border border-white/10 rounded-xl py-3.5 pl-12 pr-4 text-sm font-medium focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 transition-all placeholder:text-gray-700"
                                    placeholder="Enter username"
                                    required
                                    autoComplete="username"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider ml-1">Passkey</label>
                            <div className="relative">
                                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500 transition-colors group-focus-within:text-white" />
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full bg-black/40 border border-white/10 rounded-xl py-3.5 pl-12 pr-4 text-sm font-medium focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 transition-all placeholder:text-gray-700"
                                    placeholder="••••••••"
                                    required
                                    autoComplete="current-password"
                                />
                            </div>
                        </div>

                        {error && (
                            <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium flex items-center gap-2 animate-in fade-in slide-in-from-top-1">
                                <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></div>
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-white text-black font-bold py-3.5 rounded-xl hover:bg-gray-100 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 group/btn mt-2"
                        >
                            {isLoading ? (
                                <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                            ) : (
                                <>
                                    Initialize Session <ArrowRight className="w-4 h-4 group-hover/btn:translate-x-0.5 transition-transform" />
                                </>
                            )}
                        </button>
                    </form>
                </div>

                {/* Footer / Demo Details */}
                <div className="mt-8 mx-4">
                    <div className="flex items-center gap-2 text-[10px] text-gray-600 font-mono mb-3 uppercase tracking-wider">
                        <Terminal className="w-3 h-3" />
                        Available Nodes
                    </div>
                    <div className="space-y-2 font-mono text-xs">
                        <div className="flex justify-between items-center bg-white/5 px-3 py-2 rounded-lg border border-white/5 hover:border-white/10 transition-colors">
                            <span className="text-gray-400">admin</span>
                            <span className="text-gray-600">adminpass</span>
                        </div>
                        <div className="flex justify-between items-center bg-white/5 px-3 py-2 rounded-lg border border-white/5 hover:border-white/10 transition-colors">
                            <span className="text-gray-400">fixagent</span>
                            <span className="text-gray-600">fixpass</span>
                        </div>
                        <div className="flex justify-between items-center bg-white/5 px-3 py-2 rounded-lg border border-white/5 hover:border-white/10 transition-colors">
                            <span className="text-gray-400">voice</span>
                            <span className="text-gray-600">voicepass</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
