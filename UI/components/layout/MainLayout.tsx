import React from 'react';

interface MainLayoutProps {
    children: React.ReactNode;
}

export function MainLayout({ children }: MainLayoutProps) {
    return (
        <div data-tauri-drag-region className="min-h-screen bg-slate-900 border border-slate-700/50 rounded-xl text-slate-200 flex flex-col font-sans overflow-hidden">
            {/* Main Content Area */}
            <main data-tauri-drag-region className="flex-1 flex flex-col relative min-h-0 overflow-hidden bg-slate-900">
                {children}
            </main>
        </div>
    );
}
