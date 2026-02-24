interface ProgressBarProps {
    label: string;
    progress: number; // 0 to 100
    color: 'cyan' | 'emerald' | 'amber' | 'blue' | 'yellow';
    subLabel?: string;
}

const colorMap = {
    cyan: 'bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.8)]',
    emerald: 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]',
    amber: 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.8)]',
    blue: 'bg-blue-400 shadow-[0_0_12px_rgba(96,165,250,0.8)]',
    yellow: 'bg-yellow-400 shadow-[0_0_12px_rgba(250,204,21,0.8)]',
};

const bgMap = {
    cyan: 'bg-cyan-500/10 border-cyan-500/20',
    emerald: 'bg-emerald-500/10 border-emerald-500/20',
    amber: 'bg-amber-500/10 border-amber-500/20',
    blue: 'bg-blue-500/10 border-blue-500/20',
    yellow: 'bg-yellow-500/10 border-yellow-500/20',
};

function ProgressBar({ label, progress, color, subLabel }: ProgressBarProps) {
    const isRunning = progress > 0 && progress < 100;

    return (
        <div data-tauri-drag-region className="flex flex-col gap-1.5 relative group">
            <div data-tauri-drag-region className="flex justify-between items-end">
                <span data-tauri-drag-region className="text-[10px] font-semibold tracking-widest text-slate-400 uppercase transition-colors group-hover:text-slate-300">{label}</span>
                <div data-tauri-drag-region className="text-right flex items-baseline gap-2">
                    {subLabel && <span className="text-[9px] text-slate-500 font-medium tracking-wide">{subLabel}</span>}
                    <span className={`text-sm font-bold font-mono tracking-wider ${progress === 100 ? 'text-white' : 'text-slate-300'}`}>{Math.round(progress)}%</span>
                </div>
            </div>
            <div data-tauri-drag-region className={`h-1 w-full ${bgMap[color]} rounded-full overflow-hidden border relative backdrop-blur-sm`}>
                <div
                    className={`absolute top-0 left-0 h-full ${colorMap[color]} rounded-full transition-all duration-500 ease-out`}
                    style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
                >
                    {/* Sweeping shimmer effect when running */}
                    {isRunning && (
                        <div className="absolute top-0 left-0 bottom-0 right-0 overflow-hidden rounded-full">
                            <div className="w-[30%] h-full bg-white/40 skew-x-[-20deg] absolute left-[-50%] animate-[shimmer_2s_infinite]" />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

interface ProgressPanelProps {
    namePoolChunkProgress: number;
    namePoolTotalProgress: number;
    namePoolCount: { current: number, total: number };
    namePoolChunkCount: { current: number, total: number };
    objectPoolCurrentProgress: number;
    objectPoolTotalProgress: number;
    objectPoolCurrentCount: { current: number, total: number };
    objectPoolTotalCount: { current: number, total: number };
    seqElapsed: number | null;
    seqRunning: boolean;
}

function formatElapsed(ms: number): string {
    const totalSec = ms / 1000;
    if (totalSec < 60) return `${totalSec.toFixed(2)}s`;
    const m = Math.floor(totalSec / 60);
    const s = (totalSec % 60).toFixed(2).padStart(5, '0');
    return `${m}m ${s}s`;
}

export function ProgressPanel({ namePoolChunkProgress, namePoolTotalProgress, namePoolCount, namePoolChunkCount, objectPoolCurrentProgress, objectPoolTotalProgress, objectPoolCurrentCount, objectPoolTotalCount, seqElapsed, seqRunning }: ProgressPanelProps) {
    return (
        <div data-tauri-drag-region className="relative px-6 py-5 flex flex-col gap-4 z-30 shrink-0 bg-[#0a0f16] border-t border-[#1c2838] shadow-[0_-4px_20px_rgba(0,0,0,0.3)]">
            {/* Timer row (Always visible) */}
            <div data-tauri-drag-region className="flex items-center justify-between mb-1">
                <span data-tauri-drag-region className={`flex items-center gap-2 text-[9px] font-bold tracking-widest uppercase ${seqRunning ? 'text-amber-400' : (seqElapsed === null ? 'text-slate-500' : 'text-cyan-400')}`}>
                    {seqRunning ? (
                        <div className="relative flex items-center justify-center w-3 h-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                        </div>
                    ) : (
                        <div className="relative flex items-center justify-center w-3 h-3">
                            <div className={`absolute inset-0 rounded-full blur-[2px] opacity-60 ${seqElapsed === null ? 'bg-slate-500' : 'bg-cyan-400'}`}></div>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className={`relative z-10 ${seqElapsed === null ? 'drop-shadow-[0_0_5px_rgba(100,116,139,1)]' : 'drop-shadow-[0_0_5px_rgba(34,211,238,1)]'}`}>
                                <polyline points="20 6 9 17 4 12" />
                            </svg>
                        </div>
                    )}
                    {seqRunning ? 'Executing Pipeline' : (seqElapsed === null ? 'Awaiting Pipeline' : 'Pipeline Completed')}
                </span>
                <span className={`text-sm font-mono font-bold tracking-widest ${seqRunning ? 'text-amber-300 drop-shadow-[0_0_5px_rgba(252,211,77,0.5)]' : (seqElapsed === null ? 'text-slate-600' : 'text-cyan-300 drop-shadow-[0_0_5px_rgba(103,232,249,0.5)]')}`}>
                    {seqElapsed === null ? '0.00s' : formatElapsed(seqElapsed)}
                </span>
            </div>
            <div data-tauri-drag-region className="grid grid-cols-2 gap-x-8 gap-y-5">
                <ProgressBar
                    label="NamePool (Index)"
                    color="cyan"
                    progress={namePoolChunkProgress}
                    subLabel={`${namePoolChunkCount.current.toLocaleString()} / ${namePoolChunkCount.total.toLocaleString()}`}
                />
                <ProgressBar
                    label="NamePool (Names)"
                    color="yellow"
                    progress={namePoolTotalProgress}
                    subLabel={namePoolCount.current.toLocaleString()}
                />
                <ProgressBar
                    label="Object (Array)"
                    color="cyan"
                    progress={objectPoolCurrentProgress}
                    subLabel={`${objectPoolCurrentCount.current.toLocaleString()} / ${objectPoolCurrentCount.total.toLocaleString()}`}
                />
                <ProgressBar
                    label="Object (Total)"
                    color="yellow"
                    progress={objectPoolTotalProgress}
                    subLabel={objectPoolTotalCount.current.toLocaleString()}
                />
            </div>
        </div>
    );
}
