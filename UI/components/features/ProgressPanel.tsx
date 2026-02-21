interface ProgressBarProps {
    label: string;
    progress: number; // 0 to 100
    color: 'blue' | 'emerald' | 'amber' | 'purple';
    subLabel?: string;
}

const colorMap = {
    blue: 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.6)]',
    emerald: 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.6)]',
    amber: 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.6)]',
    purple: 'bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.6)]',
};

const bgMap = {
    blue: 'bg-blue-950/50',
    emerald: 'bg-emerald-950/50',
    amber: 'bg-amber-950/50',
    purple: 'bg-purple-950/50',
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
}

export function ProgressPanel({ namePoolChunkProgress, namePoolTotalProgress, namePoolCount, namePoolChunkCount, objectPoolCurrentProgress, objectPoolTotalProgress, objectPoolCurrentCount, objectPoolTotalCount }: ProgressPanelProps) {
    return (
        <div data-tauri-drag-region className="px-5 py-3 bg-slate-800/40 border-t border-slate-700/50 flex flex-col gap-3 shadow-lg backdrop-blur-md">
            <div data-tauri-drag-region className="grid grid-cols-2 gap-5">
                <ProgressBar
                    label="NamePool (Index)"
                    color="blue"
                    progress={namePoolChunkProgress}
                    subLabel={`${namePoolChunkCount.current.toLocaleString()} / ${namePoolChunkCount.total.toLocaleString()}`}
                />
                <ProgressBar
                    label="NamePool (Names)"
                    color="purple"
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
