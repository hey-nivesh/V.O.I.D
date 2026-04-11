import React from 'react';
import Sidebar from './Sidebar';
import RightPanel from './RightPanel';
import { useAuth } from '../../hooks/useAuth';
import PushApprovalBanner from '../PushApprovalBanner';

interface LayoutProps {
    children: React.ReactNode;
    showRightPanel?: boolean;
}

const MainLayout: React.FC<LayoutProps> = ({ children, showRightPanel = true }) => {
    const { user } = useAuth();
    return (
        <div className="min-h-screen flex font-sans p-4 gap-4">
            {/* Left Rail Sidebar */}
            <aside className="w-[88px] xl:w-[260px] flex-shrink-0 bg-white/85 backdrop-blur-xl rounded-2xl shadow-sm border border-white/50 overflow-hidden sticky top-4 h-[calc(100vh-2rem)] transition-all duration-300">
                <Sidebar />
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 flex gap-4 min-w-0 z-10">
                {/* Center Content (Grid) */}
                <div className="flex-1 min-w-0 flex flex-col">
                    {user?.role === 'admin' && <PushApprovalBanner />}
                    {children}
                </div>

                {/* Right Panel (Activity) */}
                {showRightPanel && (
                    <aside className="hidden lg:block w-[320px] flex-shrink-0 bg-white/85 backdrop-blur-xl rounded-2xl shadow-sm border border-white/50 overflow-hidden sticky top-4 h-[calc(100vh-2rem)]">
                        <RightPanel />
                    </aside>
                )}
            </main>
        </div>
    );
};

export default MainLayout;
