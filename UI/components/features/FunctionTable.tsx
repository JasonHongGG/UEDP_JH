import { Play, Check, ChevronRight } from 'lucide-react';

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
        <div data-tauri-drag-region className="flex-1 flex flex-col p-5 min-h-0 relative z-10">
            <div data-tauri-drag-region className="flex items-center justify-between mb-4 px-2">
                <h3 data-tauri-drag-region className="text-sm font-semibold text-white flex items-center gap-2 uppercase tracking-wider">
                    <div className="relative flex items-center justify-center">
                        <div className="absolute inset-0 bg-cyan-500 rounded-full blur-sm opacity-50"></div>
                        <ChevronRight size={16} className="text-cyan-400 relative z-10 pointer-events-none" />
                    </div>
                    Analysis Pipeline
                </h3>
            </div>

            <div data-tauri-drag-region className="flex-1 overflow-auto rounded-xl border border-white/5 bg-transparent shadow-inner hide-scrollbar relative">
                <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none rounded-xl" />
                <table className="w-full text-left border-collapse relative z-10">
                    <thead className="sticky top-0 z-20">
                        <tr className="bg-[#0e1620]/90 backdrop-blur-md border-b border-white/5">
                            <th className="py-3 px-4 w-14 text-center text-[9px] font-semibold text-slate-500 uppercase tracking-widest select-none">Run</th>
                            <th className="py-3 px-4 w-24 text-[9px] font-semibold text-slate-500 uppercase tracking-widest select-none">Status</th>
                            <th className="py-3 px-4 w-24 text-[9px] font-semibold text-slate-500 uppercase tracking-widest select-none">Group</th>
                            <th className="py-3 px-4 text-[9px] font-semibold text-slate-500 uppercase tracking-widest select-none">Function Name</th>
                            <th className="py-3 px-4 w-24 text-right text-[9px] font-semibold text-slate-500 uppercase tracking-widest select-none">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {functions.map((func) => (
                            <tr key={func.id} className="hover:bg-cyan-500/[0.03] transition-colors duration-300 group">
                                <td className="py-2.5 px-4 text-center">
                                    <button
                                        onClick={() => onToggle(func.id)}
                                        className="relative flex items-center justify-center w-5 h-5 transition-all outline-none mx-auto"
                                    >
                                        <div className={`absolute inset-0 rounded-full border transition-all duration-300 ${func.enabled ? 'border-cyan-400 bg-cyan-400/20 shadow-[0_0_10px_rgba(34,211,238,0.5)] scale-100' : 'border-white/20 bg-transparent scale-90 group-hover:border-white/40'
                                            }`} />
                                        {func.enabled && (
                                            <Check size={12} strokeWidth={3} className="text-cyan-300 relative z-10 animate-in zoom-in spin-in-12 duration-300 drop-shadow-[0_0_4px_rgba(34,211,238,0.8)]" />
                                        )}
                                    </button>
                                </td>
                                <td className="py-2.5 px-4">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase border ${func.status === 'idle' ? 'bg-slate-800/40 text-slate-400 border-slate-700/50' :
                                        func.status === 'running' ? 'bg-amber-500/10 text-amber-400 border-amber-500/30 shadow-[0_0_10px_rgba(245,158,11,0.2)]' :
                                            func.status === 'done' ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30 shadow-[0_0_10px_rgba(6,182,212,0.2)]' :
                                                'bg-rose-500/10 text-rose-400 border-rose-500/30 shadow-[0_0_10px_rgba(244,63,94,0.2)]'
                                        }`}>
                                        {func.status}
                                    </span>
                                </td>
                                <td className="py-2.5 px-4 select-none">
                                    <span className="text-xs font-medium text-slate-500">{func.category}</span>
                                </td>
                                <td className="py-2.5 px-4 select-none">
                                    <span className={`text-sm font-medium transition-colors ${func.enabled ? 'text-slate-200 group-hover:text-white' : 'text-slate-500'}`}>
                                        {func.name}
                                    </span>
                                </td>
                                <td className="py-2.5 px-4 text-right">
                                    <button
                                        onClick={() => onRunSingle(func.id)}
                                        className="opacity-0 group-hover:opacity-100 transition-all duration-300 translate-x-2 group-hover:translate-x-0 px-3 py-1.5 bg-white/5 hover:bg-cyan-500/20 text-slate-300 hover:text-cyan-300 text-[10px] uppercase tracking-wider font-semibold rounded border border-white/5 hover:border-cyan-500/50 flex items-center gap-1.5 ml-auto hover:shadow-[0_0_10px_rgba(6,182,212,0.3)]"
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
