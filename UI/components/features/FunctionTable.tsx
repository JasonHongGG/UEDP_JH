import { Play, CheckCircle2, Circle, ChevronRight } from 'lucide-react';

export interface AnalyzerFunction {
    id: string;
    name: string;
    category: string;
    enabled: boolean;
    status: 'idle' | 'running' | 'done' | 'error';
}

interface FunctionTableProps {
    functions: AnalyzerFunction[];
    onToggle: (id: string) => void;
    onRunSingle: (id: string) => void;
}

export function FunctionTable({ functions, onToggle, onRunSingle }: FunctionTableProps) {
    return (
        <div data-tauri-drag-region className="flex-1 flex flex-col p-3 min-h-0">

            <div data-tauri-drag-region className="flex items-center justify-between mb-2 px-1">
                <h3 data-tauri-drag-region className="text-sm font-semibold text-slate-200 flex items-center gap-1.5">
                    <ChevronRight size={16} className="text-blue-500 pointer-events-none" />
                    Analysis Pipeline
                </h3>
            </div>

            <div data-tauri-drag-region className="flex-1 overflow-auto rounded-lg border border-slate-700/50 bg-slate-900/50 shadow-inner scrollbar-hide">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-800/90 sticky top-0 z-10 backdrop-blur-md">
                        <tr>
                            <th className="py-2 px-3 w-12 text-center text-[10px] font-medium text-slate-400 uppercase tracking-wider select-none">Run</th>
                            <th className="py-2 px-3 w-20 text-[10px] font-medium text-slate-400 uppercase tracking-wider select-none">Status</th>
                            <th className="py-2 px-3 w-20 text-[10px] font-medium text-slate-400 uppercase tracking-wider select-none">Group</th>
                            <th className="py-2 px-3 text-[10px] font-medium text-slate-400 uppercase tracking-wider select-none">Function Name</th>
                            <th className="py-2 px-3 w-20 text-right text-[10px] font-medium text-slate-400 uppercase tracking-wider select-none">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                        {functions.map((func) => (
                            <tr key={func.id} className="hover:bg-slate-800/30 transition-colors group">
                                <td className="py-1.5 px-3 text-center">
                                    <button
                                        onClick={() => onToggle(func.id)}
                                        className={`flex items-center justify-center transition-colors rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500/50 ${func.enabled
                                            ? 'text-blue-500 drop-shadow-[0_0_8px_rgba(59,130,246,0.6)]'
                                            : 'text-slate-700 hover:text-slate-500'
                                            }`}
                                    >
                                        {func.enabled ? <CheckCircle2 size={16} strokeWidth={2.5} /> : <Circle size={16} strokeWidth={2} />}
                                    </button>
                                </td>
                                <td className="py-1.5 px-3">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${func.status === 'idle' ? 'bg-slate-800/50 text-slate-400 border-slate-700' :
                                        func.status === 'running' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                                            func.status === 'done' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                                                'bg-rose-500/10 text-rose-400 border-rose-500/20'
                                        }`}>
                                        {func.status.toUpperCase()}
                                    </span>
                                </td>
                                <td className="py-1.5 px-3 select-none">
                                    <span className="text-xs font-medium text-slate-500">{func.category}</span>
                                </td>
                                <td className="py-1.5 px-3 select-none">
                                    <span className={`text-xs font-medium ${func.enabled ? 'text-slate-200' : 'text-slate-400'}`}>
                                        {func.name}
                                    </span>
                                </td>
                                <td className="py-1.5 px-3 text-right">
                                    <button
                                        onClick={() => onRunSingle(func.id)}
                                        className="opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 text-[10px] font-medium rounded border border-slate-600 hover:border-slate-500 flex items-center gap-1 ml-auto"
                                    >
                                        <Play size={10} fill="currentColor" />
                                        Run
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
