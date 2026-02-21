import { useState, useCallback } from 'react';
import { PackageViewer } from './components/features/PackageViewer';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { X, Boxes, ScanEye } from 'lucide-react';

type TabId = 'package-viewer' | 'inspector';

interface TabDef {
    id: TabId;
    label: string;
    icon: React.ReactNode;
}

const TABS: TabDef[] = [
    { id: 'package-viewer', label: 'Package Viewer', icon: <Boxes size={14} /> },
    { id: 'inspector', label: 'Inspector', icon: <ScanEye size={14} /> },
];

export default function ObjectAnalysisApp() {
    const [activeTab, setActiveTab] = useState<TabId>('package-viewer');

    // Use hide() for pre-defined windows, not close()
    const handleClose = useCallback(() => {
        getCurrentWindow().hide();
    }, []);

    return (
        <div className="h-screen w-screen bg-slate-900 text-slate-200 flex flex-col font-sans overflow-hidden border border-slate-700/50 rounded-xl">
            {/* Title Bar — drag region */}
            <div data-tauri-drag-region className="flex items-center justify-between px-4 py-2.5 bg-slate-800/70 border-b border-slate-700/50 backdrop-blur-sm shrink-0 select-none">
                <div data-tauri-drag-region className="flex items-center gap-2 pointer-events-none">
                    <div className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]"></div>
                    <span className="text-xs font-semibold tracking-wide text-slate-300 uppercase">UE Dumper Console</span>
                </div>
                <button
                    onClick={handleClose}
                    title="Close Window"
                    className="flex items-center justify-center w-7 h-7 hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 rounded-md transition-colors"
                >
                    <X size={16} />
                </button>
            </div>

            {/* Tab Bar */}
            <div className="flex items-end px-3 pt-1 bg-slate-800/40 border-b border-slate-700/60 shrink-0">
                {TABS.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold tracking-wide rounded-t-lg transition-all border-b-2 ${activeTab === tab.id
                            ? 'bg-slate-900 text-white border-blue-500 shadow-[0_-2px_8px_rgba(59,130,246,0.15)]'
                            : 'text-slate-500 border-transparent hover:text-slate-300 hover:bg-slate-800/50'
                            }`}
                    >
                        {tab.icon}
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Content Area — fills all remaining space */}
            <div className="flex-1 min-h-0 overflow-hidden">
                {activeTab === 'package-viewer' && <PackageViewer />}
                {activeTab === 'inspector' && (
                    <div className="flex items-center justify-center h-full text-slate-500 text-sm">
                        Inspector — Coming soon
                    </div>
                )}
            </div>
        </div>
    );
}
