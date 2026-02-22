import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion, AnimatePresence } from "framer-motion";
import { Hash, Search, X, Box, Type, List, Database, Terminal, ShieldAlert, Cpu, Activity, Fingerprint, Layers, Link2 } from 'lucide-react';

interface RawObjectInfo {
    object_id: number;
    type_name: string;
    name: string;
    full_name: string;
    address: string;
    offset: string;
    class_ptr: string;
    outer_ptr: string;
    super_ptr: string;
    prop_size: string;
    prop_0: string;
    prop_8: string;
    function_ptr: string;
    member_ptr: string;
    member_size: string;
    bit_mask: string;
}

interface ObjectAnalyzerPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

export function ObjectAnalyzerPanel({ isOpen, onClose }: ObjectAnalyzerPanelProps) {
    const [fnameInput, setFnameInput] = useState("");
    const [fnameResult, setFnameResult] = useState<{ name?: string; error?: string } | null>(null);
    const [isFnameLoading, setIsFnameLoading] = useState(false);
    const [fnameMode, setFnameMode] = useState<'hex' | 'int'>('hex');

    const [objInput, setObjInput] = useState("");
    const [objResult, setObjResult] = useState<{ data?: RawObjectInfo; error?: string } | null>(null);
    const [isObjLoading, setIsObjLoading] = useState(false);

    // FName Analysis
    const handleAnalyzeFname = async () => {
        if (!fnameInput.trim()) return;

        let id = 0;
        const cleanInput = fnameInput.trim().replace(/^0x/i, '');
        if (fnameMode === 'hex') {
            id = parseInt(cleanInput, 16);
        } else {
            id = parseInt(cleanInput, 10);
        }

        if (isNaN(id)) {
            setFnameResult({ error: "Invalid FName ID format" });
            return;
        }

        setIsFnameLoading(true);
        try {
            const name = await invoke<string>('analyze_fname', { id });
            setFnameResult({ name });
        } catch (err: any) {
            setFnameResult({ error: err.toString() });
        } finally {
            setIsFnameLoading(false);
        }
    };

    // Object Memory Analysis
    const handleAnalyzeObject = async () => {
        if (!objInput.trim()) return;
        setIsObjLoading(true);
        try {
            const data = await invoke<RawObjectInfo>('analyze_object', { addressStr: objInput.trim() });
            setObjResult({ data });
        } catch (err: any) {
            setObjResult({ error: err.toString() });
        } finally {
            setIsObjLoading(false);
        }
    };

    return (
        <div className={`flex flex-col bg-[#0f172a]/95 backdrop-blur-xl relative z-30 shrink-0 transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] overflow-hidden border-r border-slate-800/80 shadow-[15px_0_40px_rgba(0,0,0,0.6)] ${isOpen ? 'w-[320px]' : 'w-0 border-r-0 shadow-none opacity-0'}`}>
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-slate-800/80 shrink-0 w-[320px]">
                <div className="flex items-center gap-2">
                    <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="text-[11px] font-bold uppercase tracking-widest text-slate-200">Analyzer</span>
                </div>
                <button onClick={onClose} className="text-slate-500 hover:text-rose-400 transition-colors p-1 rounded-md hover:bg-rose-500/10">
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto overflow-x-hidden w-[320px] p-4 space-y-6 scrollbar-sci-fi relative">
                {/* Background Decor */}
                <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[40%] rounded-full bg-cyan-900/5 blur-[100px] pointer-events-none" />

                {/* --- FNAME ANALYZER --- */}
                <section className="relative z-10">
                    <div className="flex items-center gap-2 mb-3">
                        <Type className="w-3.5 h-3.5 text-yellow-500" />
                        <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-300">FName Decoder</h3>
                    </div>
                    <div className="bg-slate-900/40 rounded-xl border border-slate-800/60 p-4 shadow-inner space-y-4">
                        <div className="relative group/input flex items-stretch bg-slate-950/50 border border-slate-700/50 rounded-lg focus-within:border-yellow-500/50 focus-within:bg-slate-900/80 transition-all focus-within:shadow-[0_0_15px_rgba(234,179,8,0.1)] overflow-hidden">
                            <button
                                onClick={() => setFnameMode(m => m === 'hex' ? 'int' : 'hex')}
                                className="flex items-center justify-center shrink-0 w-[42px] font-black text-[9px] text-yellow-500/50 hover:text-yellow-400 hover:bg-yellow-500/10 group-focus-within/input:text-yellow-400 transition-colors border-r border-slate-700/50 cursor-pointer"
                                title={`Mode: ${fnameMode === 'hex' ? 'HEX' : 'INT'}. Click to switch.`}
                            >
                                {fnameMode === 'hex' ? 'HEX' : 'INT'}
                            </button>
                            <input
                                type="text"
                                placeholder={fnameMode === 'hex' ? "FName ID (e.g., 1F or 0x1F)" : "FName ID (e.g., 31)"}
                                value={fnameInput}
                                onChange={e => setFnameInput(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleAnalyzeFname()}
                                className="flex-1 bg-transparent text-xs py-2.5 px-3 outline-none text-slate-200 placeholder:text-slate-600 font-mono min-w-0"
                            />
                            <button
                                onClick={handleAnalyzeFname}
                                disabled={isFnameLoading || !fnameInput}
                                className="shrink-0 px-3 bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/20 hover:text-yellow-400 text-[10px] font-bold uppercase tracking-wider transition-colors border-l border-yellow-500/20 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                            >
                                {isFnameLoading ? <Activity className="w-3 h-3 animate-pulse" /> : <Search className="w-3 h-3" />}
                                Analyze
                            </button>
                        </div>

                        <AnimatePresence mode="wait">
                            {fnameResult && (
                                <motion.div
                                    initial={{ opacity: 0, y: -10, height: 0 }}
                                    animate={{ opacity: 1, y: 0, height: 'auto' }}
                                    exit={{ opacity: 0, y: -10, height: 0 }}
                                    className="overflow-hidden"
                                >
                                    {fnameResult.error ? (
                                        <div className="flex items-start gap-2 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-3 rounded-lg font-mono">
                                            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                                            <span className="break-all">{fnameResult.error}</span>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col gap-1 bg-yellow-500/5 border border-yellow-500/20 p-3 rounded-lg mt-2">
                                            <span className="text-[10px] text-yellow-500/70 uppercase tracking-widest font-bold">Resolved String</span>
                                            <span className="text-yellow-400 font-mono text-sm font-semibold break-all selection:bg-yellow-500/30">"{fnameResult.name}"</span>
                                        </div>
                                    )}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </section>

                {/* --- GUOBJECT ANALYZER --- */}
                <section className="relative z-10">
                    <div className="flex items-center gap-2 mb-3">
                        <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                        <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-300">Object Diagnostics</h3>
                    </div>
                    <div className="bg-slate-900/40 rounded-xl border border-slate-800/60 p-4 shadow-inner space-y-4">
                        <div className="relative group/input flex items-stretch bg-slate-950/50 border border-slate-700/50 rounded-lg focus-within:border-cyan-500/50 focus-within:bg-slate-900/80 transition-all focus-within:shadow-[0_0_15px_rgba(34,211,238,0.1)] overflow-hidden">
                            <div className="flex items-center justify-center shrink-0 w-[42px] border-r border-slate-700/50">
                                <Box className="w-4 h-4 text-cyan-500/50 group-focus-within/input:text-cyan-400 transition-colors" />
                            </div>
                            <input
                                type="text"
                                placeholder="Object Address (e.g., 0xAB123)"
                                value={objInput}
                                onChange={e => setObjInput(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleAnalyzeObject()}
                                className="flex-1 bg-transparent text-xs py-2.5 px-3 outline-none text-slate-200 placeholder:text-slate-600 font-mono min-w-0"
                            />
                            <button
                                onClick={handleAnalyzeObject}
                                disabled={isObjLoading || !objInput}
                                className="shrink-0 px-3 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 hover:text-cyan-300 text-[10px] font-bold uppercase tracking-wider transition-colors border-l border-cyan-500/20 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                            >
                                {isObjLoading ? <Activity className="w-3 h-3 animate-pulse" /> : <Database className="w-3 h-3" />}
                                Analyze
                            </button>
                        </div>

                        <AnimatePresence mode="wait">
                            {objResult && (
                                <motion.div
                                    initial={{ opacity: 0, y: -10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -10 }}
                                >
                                    {objResult.error ? (
                                        <div className="flex items-start gap-2 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs p-3 rounded-lg font-mono">
                                            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                                            <span className="break-all">{objResult.error}</span>
                                        </div>
                                    ) : objResult.data ? (
                                        <div className="flex flex-col gap-2">
                                            {/* Key Headers */}
                                            <div className="bg-slate-950/60 border border-slate-800 rounded-lg p-3 space-y-2 mb-2">
                                                <div
                                                    className="flex flex-col overflow-hidden cursor-pointer group hover:bg-slate-800/40 rounded px-1.5 -mx-1.5 py-0.5 transition-colors"
                                                    onClick={() => { try { navigator.clipboard.writeText(objResult.data!.address) } catch (e) { } }}
                                                    title={`Copy ${objResult.data.address}`}
                                                >
                                                    <span className="text-[9px] uppercase tracking-widest text-slate-500 font-bold group-hover:text-slate-400 transition-colors">Base Address</span>
                                                    <span className="text-cyan-300 font-mono text-[13px] font-bold truncate group-hover:text-cyan-200 transition-colors">{objResult.data.address}</span>
                                                </div>
                                                <div className="h-[1px] bg-gradient-to-r from-slate-800 to-transparent" />
                                                <div className="flex flex-col gap-2">
                                                    <div
                                                        className="flex flex-col cursor-pointer group hover:bg-slate-800/40 rounded px-1.5 -mx-1.5 py-0.5 transition-colors"
                                                        onClick={() => { try { navigator.clipboard.writeText(objResult.data!.object_id.toString()) } catch (e) { } }}
                                                        title={`Copy ${objResult.data.object_id}`}
                                                    >
                                                        <span className="text-[9px] uppercase tracking-widest text-slate-500 flex items-center gap-1 group-hover:text-slate-400 transition-colors">
                                                            <Fingerprint className="w-3 h-3" /> Object ID
                                                        </span>
                                                        <span className="text-white font-mono text-sm group-hover:text-slate-200 transition-colors">{objResult.data.object_id}</span>
                                                    </div>
                                                    <div
                                                        className="flex flex-col cursor-pointer group hover:bg-slate-800/40 rounded px-1.5 -mx-1.5 py-0.5 transition-colors"
                                                        onClick={() => { try { navigator.clipboard.writeText(objResult.data!.type_name) } catch (e) { } }}
                                                        title={`Copy ${objResult.data.type_name}`}
                                                    >
                                                        <span className="text-[9px] uppercase tracking-widest text-slate-500 flex items-center gap-1 group-hover:text-slate-400 transition-colors">
                                                            <Type className="w-3 h-3" /> Class Type
                                                        </span>
                                                        <span className="text-white font-mono text-xs break-all group-hover:text-slate-200 transition-colors">
                                                            {objResult.data.type_name}
                                                        </span>
                                                    </div>
                                                    <div
                                                        className="flex flex-col pt-1 cursor-pointer group hover:bg-slate-800/40 rounded px-1.5 -mx-1.5 py-0.5 transition-colors"
                                                        onClick={() => { try { navigator.clipboard.writeText(objResult.data!.name) } catch (e) { } }}
                                                        title={`Copy ${objResult.data.name}`}
                                                    >
                                                        <span className="text-[9px] uppercase tracking-widest text-slate-500 flex items-center gap-1 group-hover:text-slate-400 transition-colors">
                                                            <Hash className="w-3 h-3" /> Name
                                                        </span>
                                                        <span className="text-white font-mono text-xs break-all group-hover:text-slate-200 transition-colors">
                                                            {objResult.data.name}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Detailed Pointers List */}
                                            <div className="bg-slate-950/40 border border-slate-800/80 rounded-lg overflow-hidden">
                                                <motion.ul
                                                    initial="hidden"
                                                    animate="visible"
                                                    variants={{
                                                        hidden: { opacity: 0 },
                                                        visible: { opacity: 1, transition: { staggerChildren: 0.03 } }
                                                    }}
                                                    className="divide-y divide-slate-800/50"
                                                >
                                                    <DetailRow label="Class Ptr" val={objResult.data.class_ptr} icon={<Link2 />} />
                                                    <DetailRow label="Outer Ptr" val={objResult.data.outer_ptr} icon={<Layers />} />
                                                    <DetailRow label="Super Ptr" val={objResult.data.super_ptr} icon={<Link2 />} />
                                                    <DetailRow label="Prop Size" val={objResult.data.prop_size} icon={<Database />} />
                                                    <DetailRow label="Prop Ptr 0" val={objResult.data.prop_0} icon={<List />} />
                                                    <DetailRow label="Prop Ptr 1" val={objResult.data.prop_8} icon={<List />} />
                                                    <DetailRow label="Offset" val={objResult.data.offset} icon={<Hash />} />
                                                    <DetailRow label="Func Ptr" val={objResult.data.function_ptr} icon={<Terminal />} />
                                                    <DetailRow label="Member Ptr" val={objResult.data.member_ptr} icon={<List />} />
                                                    <DetailRow label="Member Size" val={objResult.data.member_size} icon={<Database />} />
                                                    <DetailRow label="Bit Mask" val={objResult.data.bit_mask} icon={<Fingerprint />} />
                                                </motion.ul>
                                            </div>
                                        </div>
                                    ) : null}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </section>
            </div>
        </div>
    );
}

function DetailRow({ label, val, icon }: { label: string, val: string, icon: React.ReactNode }) {
    const isNA = val === "0x0" || val === "0x0 (0)";
    const displayVal = isNA ? "N/A" : val;

    const copyToClipboard = async () => {
        if (isNA) return;
        try {
            await navigator.clipboard.writeText(val);
        } catch (err) { }
    };

    return (
        <motion.li
            variants={{
                hidden: { opacity: 0, x: -10 },
                visible: { opacity: 1, x: 0 }
            }}
            className={`flex items-center justify-between px-3 py-2 transition-colors group ${isNA ? '' : 'hover:bg-slate-800/40 cursor-pointer'}`}
            onClick={copyToClipboard}
            title={isNA ? undefined : `Copy ${displayVal}`}
        >
            <div className="flex items-center gap-2">
                <div className={`w-3 h-3 transition-opacity [&>svg]:w-full [&>svg]:h-full shrink-0 ${isNA ? 'text-slate-700' : 'text-slate-500 opacity-70 group-hover:opacity-100'}`}>
                    {icon}
                </div>
                <span className={`text-[10px] uppercase font-bold tracking-widest transition-colors ${isNA ? 'text-slate-700' : 'text-slate-500 group-hover:text-slate-400'}`}>
                    {label}
                </span>
            </div>
            <span className={`text-[11px] font-mono font-medium truncate max-w-[140px] text-right transition-colors ${isNA ? 'text-slate-700' : 'text-cyan-400 group-hover:text-cyan-300'}`}>
                {displayVal}
            </span>
        </motion.li>
    );
}
