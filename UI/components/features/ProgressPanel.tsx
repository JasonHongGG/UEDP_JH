interface ProgressBarProps {
    label: string;
    progress: number; // 0 to 100
    color: 'blue' | 'emerald' | 'amber' | 'yellow';
    subLabel?: string;
}

const colorMap = {
    blue: 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.6)]',
    emerald: 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.6)]',
    amber: 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.6)]',
    yellow: 'bg-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.6)]',
};

const bgMap = {
    blue: 'bg-blue-950/50',
    emerald: 'bg-emerald-950/50',
    amber: 'bg-amber-950/50',
    yellow: 'bg-yellow-950/50',
};

function ProgressBar({ label, progress, color, subLabel }: ProgressBarProps) {
    return (
        <div data-tauri-drag-region className="flex flex-col gap-1">
            <div data-tauri-drag-region className="flex justify-between items-end">
                <span data-tauri-drag-region className="text-[10px] font-semibold tracking-wide text-slate-300 uppercase">{label}</span>
                <div data-tauri-drag-region className="text-right">
                    <span className="text-xs font-bold text-white">{Math.round(progress)}%</span>
                    {subLabel && <span className="text-[10px] text-slate-500 ml-1.5 font-medium">{subLabel}</span>}
                </div>
            </div>
            <div data-tauri-drag-region className={`h-1.5 w-full ${bgMap[color]} rounded-full overflow-hidden border border-slate-700/50`}>
                <div
                    className={`h-full ${colorMap[color]} rounded-full transition-all duration-300 ease-out`}
                    style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
                />
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
        <div data-tauri-drag-region className="px-5 py-3 bg-slate-800/40 border-t border-slate-700/50 flex flex-col gap-3 shadow-lg backdrop-blur-md">
            {/* Timer row */}
            {seqElapsed !== null && (
                <div data-tauri-drag-region className="flex items-center justify-between">
                    <span data-tauri-drag-region className={`flex items-center gap-1.5 text-[10px] font-semibold tracking-wide uppercase ${seqRunning ? 'text-yellow-400' : 'text-emerald-400'}`}>
                        {seqRunning ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="13" r="8" />
                                <polyline points="12 9 12 13 14.5 15.5" />
                                <line x1="9" y1="2" x2="15" y2="2" />
                                <line x1="12" y1="2" x2="12" y2="5" />
                            </svg>
                        ) : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                            </svg>
                        )}
                        {seqRunning ? 'RUNNING' : 'COMPLETED'}
                    </span>
                    <span className={`text-sm font-mono font-bold tabular-nums ${seqRunning ? 'text-yellow-300' : 'text-emerald-300'}`}>
                        {formatElapsed(seqElapsed)}
                    </span>
                </div>
            )}
            <div data-tauri-drag-region className="grid grid-cols-2 gap-5">
                <ProgressBar
                    label="NamePool (Index)"
                    color="blue"
                    progress={namePoolChunkProgress}
                    subLabel={`${namePoolChunkCount.current.toLocaleString()} / ${namePoolChunkCount.total.toLocaleString()}`}
                />
                <ProgressBar
                    label="NamePool (Names)"
                    color="yellow"
                    progress={namePoolTotalProgress}
                    subLabel={`${namePoolCount.current.toLocaleString()} / ${namePoolCount.total.toLocaleString()}`}
                />
            </div>
            <div data-tauri-drag-region className="grid grid-cols-2 gap-5">
                <ProgressBar
                    label="Object (Array)"
                    color="amber"
                    progress={objectPoolCurrentProgress}
                    subLabel={`${objectPoolCurrentCount.current.toLocaleString()} / ${objectPoolCurrentCount.total.toLocaleString()}`}
                />
                <ProgressBar
                    label="Object (Total)"
                    color="emerald"
                    progress={objectPoolTotalProgress}
                    subLabel={`${objectPoolTotalCount.current.toLocaleString()} / ${objectPoolTotalCount.total.toLocaleString()}`}
                />
            </div>
        </div>
    );
}
