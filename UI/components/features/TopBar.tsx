import { Activity, Target, Play, X, Boxes } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

interface TopBarProps {
    attachedProcess: string | null;
    onOpenSelector: () => void;
    onRunAllEnabled: () => void;
}

export function TopBar({ attachedProcess, onOpenSelector, onRunAllEnabled }: TopBarProps) {
    const handleClose = () => {
        getCurrentWindow().close();
    };

    const handleOpenObjectAnalysis = async () => {
        try {
            const win = await WebviewWindow.getByLabel('object-analysis');
            if (win) {
                await win.show();
                await win.setFocus();
            }
        } catch (error) {
            console.error("Failed to open object analysis window:", error);
        }
    };

    return (
        <div data-tauri-drag-region className="flex items-center justify-between px-4 py-3 bg-slate-800/50 border-b border-slate-700/50 backdrop-blur-sm">
            <div data-tauri-drag-region className="flex items-center gap-2">
                <div data-tauri-drag-region className={`p-1.5 rounded-lg ${attachedProcess ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                    <Activity size={16} strokeWidth={2.5} className="pointer-events-none" />
                </div>
                <div data-tauri-drag-region>
                    <h2 data-tauri-drag-region className="text-xs font-medium text-slate-400">Target Process</h2>
                    <div data-tauri-drag-region className="text-sm font-semibold tracking-wide text-white">
                        {attachedProcess ? (
                            <span className="text-emerald-400">{attachedProcess}</span>
                        ) : (
                            <span className="text-rose-400 pointer-events-none">No Process Attached</span>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-2">
                <button
                    onClick={onOpenSelector}
                    title="Select Process"
                    className="flex items-center justify-center w-8 h-8 bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-all shadow-lg shadow-blue-500/20 hover:shadow-blue-500/40 active:scale-95 border border-blue-500/50"
                >
                    <Target size={16} />
                </button>
                <button
                    onClick={onRunAllEnabled}
                    title="Run Selected Sequence"
                    className="flex items-center justify-center w-8 h-8 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md transition-all shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/40 active:scale-95 border border-emerald-500/50"
                >
                    <Play size={15} fill="currentColor" />
                </button>
                <button
                    onClick={handleOpenObjectAnalysis}
                    title="Open Object Analysis"
                    className="flex items-center justify-center w-8 h-8 bg-yellow-400 hover:bg-yellow-300 text-white rounded-md transition-all shadow-lg shadow-yellow-400/20 hover:shadow-yellow-400/40 active:scale-95 border border-yellow-300/50"
                >
                    <Boxes size={15} strokeWidth={2.5} />
                </button>
                <div className="w-[1px] h-6 bg-slate-700/50 mx-1"></div>
                <button
                    onClick={handleClose}
                    title="Close Window"
                    className="flex items-center justify-center w-8 h-8 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 rounded-md transition-colors"
                >
                    <X size={18} />
                </button>
            </div>
        </div>
    );
}
