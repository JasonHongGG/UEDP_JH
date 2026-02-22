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
        <div data-tauri-drag-region className="flex items-center justify-between px-5 py-3 bg-[#05080c] border-b border-[#1c2838] shadow-[0_4px_15px_rgba(0,0,0,0.4)] z-30 relative shrink-0">
            <div data-tauri-drag-region className="flex items-center gap-3 relative z-10">
                <div data-tauri-drag-region className="relative flex items-center justify-center w-8 h-8">
                    {/* Glowing pulse behind icon */}
                    <div className={`absolute inset-0 rounded-full blur-[6px] opacity-40 ${attachedProcess ? 'bg-cyan-500' : 'bg-rose-500'}`} />
                    <div className={`relative z-10 p-1.5 rounded-full border border-white/5 bg-white/5 backdrop-blur-sm ${attachedProcess ? 'text-cyan-400' : 'text-rose-400'}`}>
                        <Activity size={16} strokeWidth={2.5} className="pointer-events-none" />
                    </div>
                </div>

                <div data-tauri-drag-region className="flex flex-col justify-center">
                    <h2 data-tauri-drag-region className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Target Process</h2>
                    <div data-tauri-drag-region className="text-sm font-semibold tracking-wide text-white flex items-center gap-2">
                        {attachedProcess ? (
                            <span className="text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]">{attachedProcess}</span>
                        ) : (
                            <span className="text-rose-400/80 pointer-events-none">No Process Attached</span>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-2 relative z-10">
                <button
                    onClick={onOpenSelector}
                    title="Select Process"
                    className="group flex items-center justify-center w-9 h-9 bg-white/5 hover:bg-cyan-500/10 text-slate-300 hover:text-cyan-300 rounded-lg transition-all duration-300 border border-white/5 hover:border-cyan-500/50 hover:shadow-[0_0_15px_rgba(6,182,212,0.3)] active:scale-95"
                >
                    <Target size={17} className="group-hover:drop-shadow-[0_0_8px_rgba(34,211,238,0.8)] transition-all" />
                </button>
                <button
                    onClick={onRunAllEnabled}
                    title="Run Selected Sequence"
                    className="group flex items-center justify-center w-9 h-9 bg-white/5 hover:bg-cyan-500/10 text-slate-300 hover:text-cyan-300 rounded-lg transition-all duration-300 border border-white/5 hover:border-cyan-500/50 hover:shadow-[0_0_15px_rgba(6,182,212,0.3)] active:scale-95"
                >
                    <Play size={16} fill="currentColor" className="group-hover:drop-shadow-[0_0_8px_rgba(34,211,238,0.8)] transition-all ml-0.5" />
                </button>
                <button
                    onClick={handleOpenObjectAnalysis}
                    title="Open Object Analysis"
                    className="group flex items-center justify-center w-9 h-9 bg-white/5 hover:bg-cyan-500/10 text-slate-300 hover:text-cyan-300 rounded-lg transition-all duration-300 border border-white/5 hover:border-cyan-500/50 hover:shadow-[0_0_15px_rgba(6,182,212,0.3)] active:scale-95"
                >
                    <Boxes size={17} strokeWidth={2} className="group-hover:drop-shadow-[0_0_8px_rgba(34,211,238,0.8)] transition-all" />
                </button>
                <div className="w-[1px] h-6 bg-white/10 mx-1"></div>
                <button
                    onClick={handleClose}
                    title="Close Window"
                    className="group flex items-center justify-center w-9 h-9 bg-white/5 hover:bg-rose-500/10 text-slate-500 hover:text-rose-400 rounded-lg transition-all duration-300 border border-transparent hover:border-rose-500/30"
                >
                    <X size={18} className="group-hover:drop-shadow-[0_0_8px_rgba(244,63,94,0.5)] transition-all" />
                </button>
            </div>
        </div>
    );
}
