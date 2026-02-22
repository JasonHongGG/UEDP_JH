import React, { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Download, Upload, Server, Search, Activity, Trash2, Cpu, Copy, Edit3, Box, Play, Square, WifiHigh, X } from 'lucide-react';
import { useApiStore, ApiPropertyInfo, ApiGroup } from '../../store/apiStore';

type TreeNode = {
    name: string;
    path: string;
    children: Record<string, TreeNode>;
    property?: ApiPropertyInfo;
};

const buildTree = (parameters: ApiPropertyInfo[]): TreeNode => {
    const root: TreeNode = { name: 'root', path: '', children: {} };
    for (const param of parameters) {
        const parts = param.full_path.split('.');
        let current = root;
        let currentPath = '';
        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            currentPath = currentPath ? `${currentPath}.${part}` : part;
            if (!current.children[part]) {
                current.children[part] = { name: part, path: currentPath, children: {} };
            }
            current = current.children[part];
        }
        const leafName = parts[parts.length - 1];
        if (!current.children[leafName]) {
            current.children[leafName] = { name: leafName, path: param.full_path, children: {}, property: param };
        } else {
            current.children[leafName].property = param;
        }
    }
    return root;
};

// --- Custom Neon Animated Toggle ---
const NeonToggle = ({ checked, onChange }: { checked: boolean, onChange?: (val: boolean) => void }) => (
    <div
        onClick={(e) => { e.stopPropagation(); onChange?.(!checked); }}
        className={`relative w-10 h-5 rounded-full transition-all duration-300 cursor-pointer shrink-0 ${checked
            ? 'bg-emerald-500/20 border border-emerald-500/60 shadow-[0_0_12px_rgba(16,185,129,0.4)]'
            : 'bg-slate-800/80 border border-slate-700/60'
            } `}>
        <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all duration-300 shadow-md ${checked
            ? 'left-[calc(100%-18px)] bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.8)]'
            : 'left-0.5 bg-slate-500'
            } `}>
            {checked && <div className="absolute inset-0.5 rounded-full bg-white/30 blur-[1px]" />}
        </div>
    </div>
);

// --- Draggable Number Input ---
const DraggableNumberInput = ({ initialValue, isFloat, onWriteValue }: { initialValue: string, isFloat: boolean, onWriteValue?: (val: string) => void }) => {
    const [value, setValue] = useState(initialValue);
    const [isEditing, setIsEditing] = useState(false);
    const [isDragActive, setIsDragActive] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const isDragging = useRef(false);
    const startY = useRef(0);
    const startX = useRef(0);
    const startVal = useRef(0);
    const lastWriteTime = useRef(0);

    useEffect(() => {
        if (!isDragActive && !isEditing) {
            setValue(initialValue);
        }
    }, [initialValue, isDragActive, isEditing]);

    const handlePointerDown = (e: React.PointerEvent) => {
        if (isEditing) return;
        e.preventDefault();
        isDragging.current = true;
        setIsDragActive(true);
        startY.current = e.clientY;
        startX.current = e.clientX;
        startVal.current = parseFloat(value) || 0;
        document.body.style.cursor = 'ew-resize';

        const handlePointerMove = (eMove: PointerEvent) => {
            if (!isDragging.current) return;
            const delta = (eMove.clientX - startX.current) + (startY.current - eMove.clientY);

            let newValStr;
            if (!isFloat) {
                const sensitivity = 1;
                const steps = Math.round(delta * sensitivity);
                newValStr = (startVal.current + steps).toString();
            } else {
                const sensitivity = 0.05;
                const steps = Math.round(delta * sensitivity);
                const newVal = startVal.current + (steps * 0.1);
                newValStr = parseFloat(newVal.toPrecision(10)).toString();
            }

            setValue(newValStr);

            const now = Date.now();
            if (now - lastWriteTime.current > 100) {
                lastWriteTime.current = now;
                onWriteValue?.(newValStr);
            }
        };

        const handlePointerUp = () => {
            if (isDragging.current) {
                isDragging.current = false;
                setIsDragActive(false);
                document.body.style.cursor = 'default';
                window.removeEventListener('pointermove', handlePointerMove);
                window.removeEventListener('pointerup', handlePointerUp);

                if (inputRef.current) {
                    onWriteValue?.(inputRef.current.value);
                }
            }
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
    };

    return (
        <div className={`relative flex items-center w-full group/num transition-all duration-200 rounded-md overflow-hidden ${isDragActive ? 'ring-1 ring-emerald-500/40' : ''}`}>
            <div className={`absolute inset-0 rounded-md transition-opacity duration-200 pointer-events-none ${isEditing ? 'bg-slate-800/80 border border-emerald-500/40' : 'bg-slate-900/40 border border-slate-700/40 group-hover/num:border-slate-600/60'} `} />
            <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onPointerDown={handlePointerDown}
                onDoubleClick={() => { setIsEditing(true); setTimeout(() => inputRef.current?.focus(), 0); }}
                onBlur={() => {
                    setIsEditing(false);
                    onWriteValue?.(value);
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        setIsEditing(false);
                        onWriteValue?.(value);
                    }
                }}
                readOnly={!isEditing}
                className="relative z-10 w-full bg-transparent px-2.5 py-1 text-xs font-mono text-slate-200 focus:outline-none cursor-ew-resize select-none"
            />
            <div className="relative z-10 pr-2 shrink-0">
                {isEditing
                    ? <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_rgba(16,185,129,0.8)]" />
                    : <Edit3 size={9} className="text-slate-600 group-hover/num:text-slate-400 transition-colors" />
                }
            </div>
        </div>
    );
};

export function ApiPanel() {
    const { apiGroups, serverRunning, serverPort, setServerRunning, setServerPort, updateInstanceAddress, importGroups, removeGroup, removeParameter } = useApiStore();
    const [isLocating, setIsLocating] = useState(false);
    const [portInput, setPortInput] = useState(serverPort.toString());

    const copyToClipboard = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
        } catch (err) { }
    };

    const handleAutoLocate = async () => {
        setIsLocating(true);
        for (const group of apiGroups) {
            try {
                const results = await invoke<{ instance_address: string, object_name: string }[]>('search_object_instances', { objectAddress: group.classObjectId });
                const match = results.find(r => r.object_name.toLowerCase() === group.instanceName.toLowerCase());
                if (match) {
                    updateInstanceAddress(group.id, match.instance_address);
                }
            } catch (e) {
                console.error("Auto locate error:", e);
            }
        }
        setIsLocating(false);
    };

    const toggleServer = async () => {
        if (!serverRunning) {
            try {
                const p = parseInt(portInput) || 3030;
                setServerPort(p);
                await invoke('start_api_server', { port: p });
                setServerRunning(true);
            } catch (e) {
                console.error("Server start error:", e);
                alert(`Failed to start server: ${e} `);
            }
        } else {
            // Cannot easily kill Axum without cancellation tokens, but we represent it in UI
            setServerRunning(false);
        }
    };

    const [showDocs, setShowDocs] = useState(false);

    const exportJson = () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(apiGroups, null, 2));
        const anchor = document.createElement('a');
        anchor.href = dataStr;
        anchor.download = 'uedp-api-groups.json';
        anchor.click();
    };

    const importJson = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const json = JSON.parse(evt.target?.result as string);
                if (Array.isArray(json)) {
                    importGroups(json);
                }
            } catch (err) {
                alert("Invalid JSON format");
            }
        };
        reader.readAsText(file);
    };

    const writeProperty = async (prop: ApiPropertyInfo, newValue: string) => {
        try {
            await invoke('write_instance_property', {
                address: prop.memory_address,
                offsetStr: prop.offset,
                propertyType: prop.property_type,
                newValue: newValue.toString()
            });
            // Optionally dispatch to update live value in store if needed
        } catch (error) {
            console.error("Failed to write property:", error);
        }
    };

    const renderTreeNodes = (nodes: TreeNode[], depth: number, groupId: string) => {
        return (
            <div className={`flex flex-col relative w-full ${depth > 0 ? 'pl-6 mt-1' : ''}`}>
                {depth > 0 && <div className="absolute left-[10px] top-0 bottom-4 w-[1px] bg-slate-700/50"></div>}
                {nodes.map((node) => {
                    const hasChildren = Object.keys(node.children).length > 0;
                    const prop = node.property;

                    return (
                        <div key={node.path} className="flex flex-col w-full relative">
                            {prop ? (
                                <div className="flex items-center py-2 px-3 gap-3 hover:bg-slate-800/40 border border-transparent hover:border-slate-700/50 rounded-md transition-all group/row w-full cursor-default">
                                    <div className="flex-1 flex flex-col justify-center min-w-0">
                                        <div className="flex items-center gap-3">
                                            {/* Offset */}
                                            <span className="text-[11px] w-12 text-left font-mono shrink-0">
                                                <span className="text-slate-600">+</span><span className="text-slate-400/80">{prop.offset}</span>
                                            </span>
                                            {/* Type & Name */}
                                            <div className="flex items-center gap-2">
                                                {(() => {
                                                    const typeLower = prop.property_type.toLowerCase();
                                                    const isObjectRef = typeLower.includes('object') || typeLower.includes('class') || typeLower.includes('interface');
                                                    const typeLabel = prop.property_type.replace('Property', '');

                                                    if (isObjectRef) {
                                                        return (
                                                            <button
                                                                className="inline-flex items-center text-[11px] font-semibold text-white/90 w-32 truncate shrink-0 text-left hover:text-amber-300 transition-colors cursor-pointer"
                                                                title={`Copy: ${prop.sub_type || 'Object'}`}
                                                                onClick={(e) => { e.stopPropagation(); copyToClipboard(prop.sub_type || 'Object'); }}
                                                            >
                                                                <span className="truncate">{prop.sub_type || 'Object'}</span>
                                                            </button>
                                                        );
                                                    } else if (typeLower.includes('bool')) {
                                                        return (
                                                            <div className="text-[11px] w-32 truncate shrink-0 text-violet-400/80">
                                                                {typeLabel}
                                                            </div>
                                                        );
                                                    } else if (typeLower.includes('float') || typeLower.includes('double') || typeLower.includes('int')) {
                                                        return (
                                                            <div className="text-[11px] w-32 truncate shrink-0 text-teal-400/80">
                                                                {typeLabel}
                                                            </div>
                                                        );
                                                    } else if (typeLower.includes('array') || typeLower.includes('map') || typeLower.includes('set')) {
                                                        return (
                                                            <div className="text-[11px] w-32 shrink-0 text-indigo-400/80 flex items-center gap-1">
                                                                <span className="truncate">{typeLabel}</span>
                                                                {prop.sub_type && <span className="text-amber-500/70">‹{prop.sub_type}›</span>}
                                                            </div>
                                                        );
                                                    } else {
                                                        return (
                                                            <div className="text-[11px] text-blue-400/70 w-32 truncate shrink-0" title={prop.property_type}>
                                                                <span>{typeLabel}</span>
                                                                {prop.sub_type && <span className="text-amber-500/70 ml-1">‹{prop.sub_type}›</span>}
                                                            </div>
                                                        );
                                                    }
                                                })()}
                                                <span className="text-[13px] text-slate-100/90 font-medium tracking-tight truncate flex-1">{prop.property_name}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0 justify-end w-[280px]">
                                        <button
                                            className="prop-addr flex items-center gap-1 text-[10px] font-mono text-slate-600 hover:text-emerald-400 transition-colors"
                                            onClick={(e) => { e.stopPropagation(); copyToClipboard(prop.memory_address); }}
                                            title={`Copy: ${prop.memory_address}`}
                                        >
                                            <Copy size={8} />
                                            <span>{prop.memory_address}</span>
                                        </button>

                                        {/* Value Widget */}
                                        {prop.property_type.toLowerCase().includes('bool') ? (
                                            <NeonToggle checked={prop.live_value === 'True'} onChange={(v) => writeProperty(prop, v ? "True" : "False")} />
                                        ) : prop.is_object ? (
                                            <button
                                                className="w-[160px] h-[26px] flex items-center bg-cyan-950/30 border border-cyan-900/40 hover:border-cyan-700/60 rounded-lg px-2.5 text-xs font-mono text-cyan-300/80 hover:text-cyan-100 transition-all duration-200 shadow-[inset_0_0_10px_rgba(8,145,178,0.1)] hover:shadow-[inset_0_0_14px_rgba(34,211,238,0.15)] overflow-hidden cursor-pointer"
                                                onClick={(e) => { e.stopPropagation(); copyToClipboard(prop.object_instance_address || prop.memory_address); }}
                                                title={prop.object_instance_address || prop.memory_address}
                                            >
                                                <span className="min-w-0 truncate block">{prop.object_instance_address || prop.memory_address}</span>
                                            </button>
                                        ) : prop.property_type.toLowerCase().includes('name') || prop.property_type.toLowerCase().includes('str') ? (
                                            <button
                                                className="w-[160px] h-[26px] flex items-center bg-amber-900/10 border border-amber-800/20 hover:border-amber-600/40 rounded-lg px-2.5 text-xs text-amber-200/70 hover:text-amber-100 transition-all duration-200 overflow-hidden cursor-pointer"
                                                onClick={(e) => { e.stopPropagation(); copyToClipboard(prop.live_value); }}
                                                title={prop.live_value}
                                            >
                                                <span className="min-w-0 truncate block font-mono">{prop.live_value || '—'}</span>
                                            </button>
                                        ) : (
                                            <div className="w-[160px]">
                                                <DraggableNumberInput
                                                    initialValue={prop.live_value}
                                                    isFloat={prop.property_type.toLowerCase().includes('float') || prop.property_type.toLowerCase().includes('double')}
                                                    onWriteValue={(val) => writeProperty(prop, val)}
                                                />
                                            </div>
                                        )}

                                        {/* Remove Button */}
                                        <button
                                            onClick={() => removeParameter(groupId, prop.full_path)}
                                            className="p-1 opacity-0 group-hover/row:opacity-100 text-slate-500 hover:text-rose-400 transition-all hover:bg-rose-500/10 rounded ml-2"
                                            title="Remove Parameter"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex items-center py-1.5 px-3 gap-3 hover:bg-slate-800/40 border-b border-slate-800/30 w-full transition-all group/row cursor-default rounded-sm">
                                    <div className="flex-1 flex items-center gap-3 min-w-0">
                                        {/* Empty Offset slot for alignment */}
                                        <div className="w-12 shrink-0"></div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                className="inline-flex items-center text-[11px] font-semibold text-white/90 w-32 truncate shrink-0 text-left hover:text-amber-300 transition-colors cursor-pointer"
                                                title={`Copy: ${node.property?.sub_type || node.name || 'Object'}`}
                                                onClick={(e) => { e.stopPropagation(); copyToClipboard(node.property?.sub_type || node.name || 'Object'); }}
                                            >
                                                <span className="truncate">{node.property?.sub_type || node.name || 'Object'}</span>
                                            </button>
                                            <button
                                                className="text-[13px] text-slate-100/90 font-medium tracking-tight truncate hover:text-cyan-300 transition-colors cursor-pointer"
                                                title={`Copy: ${node.name}`}
                                                onClick={(e) => { e.stopPropagation(); copyToClipboard(node.name); }}
                                            >
                                                {node.name}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0 justify-end w-[280px]">
                                    </div>
                                </div>
                            )}

                            {hasChildren && renderTreeNodes(Object.values(node.children), depth + 1, groupId)}
                        </div>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="flex flex-col w-full h-full bg-[#0a0f18] text-slate-300 font-sans relative overflow-hidden">
            {/* Ambient Background Glows */}
            <div className="absolute top-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-900/20 blur-[120px] pointer-events-none" />
            <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-cyan-900/10 blur-[100px] pointer-events-none" />

            {/* Top Control Bar */}
            <div className="w-full flex items-center justify-between p-4 bg-slate-900/60 backdrop-blur-md border-b border-slate-800 shadow-md relative z-10 shrink-0">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-emerald-500/20 border border-emerald-500/30 rounded-lg shadow-[0_0_15px_rgba(16,185,129,0.2)]">
                        <WifiHigh className="text-emerald-400" size={20} />
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-white tracking-widest uppercase">API Gateway</h2>
                        <span className="text-[10px] text-slate-400 font-mono tracking-wider">REST / AUTOMATION INTERFACE</span>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    {/* JSON I/O */}
                    <div className="flex items-center bg-slate-800/50 rounded-lg p-1 border border-slate-700/50">
                        <button onClick={exportJson} className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:text-white hover:bg-slate-700/50 rounded-md transition-colors" title="Export to JSON">
                            <Download size={14} /> Export
                        </button>
                        <div className="w-[1px] h-4 bg-slate-700/80 mx-1"></div>
                        <label className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-300 hover:text-white hover:bg-slate-700/50 rounded-md transition-colors cursor-pointer" title="Import from JSON">
                            <Upload size={14} /> Import
                            <input type="file" accept=".json" className="hidden" onChange={importJson} />
                        </label>
                    </div>

                    {/* Auto Locate */}
                    <button
                        onClick={handleAutoLocate}
                        disabled={isLocating}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-lg text-sm text-white font-medium shadow transition-all disabled:opacity-50"
                    >
                        {isLocating ? <Activity size={16} className="animate-spin text-cyan-400" /> : <Search size={16} className="text-cyan-400" />}
                        Auto Locate
                    </button>

                    {/* Server Toggle */}
                    <div className="flex items-center bg-slate-800 border border-slate-700 rounded-lg overflow-hidden shadow">
                        <div className="px-3 py-2 border-r border-slate-700 bg-slate-900/50 flex items-center gap-2">
                            <span className="text-xs font-mono text-slate-400">PORT</span>
                            <input
                                type="text"
                                value={portInput}
                                onChange={(e) => setPortInput(e.target.value)}
                                disabled={serverRunning}
                                className="w-14 bg-transparent text-sm font-mono text-white focus:outline-none"
                            />
                        </div>
                        <button
                            onClick={toggleServer}
                            className={`flex items-center gap-2 px-4 py-2 text-sm font-bold tracking-wide transition-all ${serverRunning
                                ? 'bg-rose-500/20 text-rose-400 hover:bg-rose-500/30'
                                : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                                } `}
                        >
                            {serverRunning ? <Square size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
                            {serverRunning ? 'STOP' : 'START'}
                        </button>
                    </div>

                    {/* Docs Toggle */}
                    <button
                        onClick={() => setShowDocs(!showDocs)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${showDocs ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700'
                            }`}
                        title="API Documentation"
                    >
                        <Server size={14} /> Docs
                    </button>
                </div>
            </div>

            {/* Docs Section */}
            {showDocs && (
                <div className="w-full bg-slate-900 border-b border-indigo-500/20 p-6 flex flex-col items-center shrink-0 shadow-lg relative z-20">
                    <div className="w-full max-w-5xl flex gap-6">
                        <div className="flex-1 bg-slate-950/50 p-4 rounded-xl border border-slate-800 shadow-inner">
                            <h3 className="text-emerald-400 font-mono text-sm mb-2 flex items-center gap-2">
                                <span className="px-1.5 py-0.5 bg-emerald-500/20 rounded font-bold">GET</span> /api/locate
                            </h3>
                            <p className="text-xs text-slate-400 mb-3">Find dynamic instance address using class and name.</p>
                            <pre className="text-[10px] font-mono text-slate-300 bg-[#0a0f18] p-3 rounded-lg border border-slate-800 overflow-x-auto shadow-inner">
                                {`curl "http://localhost:${serverPort}/api/locate?class_address=0x123&instance_name=MyInstance"`}
                            </pre>
                        </div>
                        <div className="flex-1 bg-slate-950/50 p-4 rounded-xl border border-slate-800 shadow-inner">
                            <h3 className="text-sky-400 font-mono text-sm mb-2 flex items-center gap-2">
                                <span className="px-1.5 py-0.5 bg-sky-500/20 rounded font-bold">POST</span> /api/write
                            </h3>
                            <p className="text-xs text-slate-400 mb-3">Update property value. Requires memory address or offset.</p>
                            <pre className="text-[10px] font-mono text-slate-300 bg-[#0a0f18] p-3 rounded-lg border border-slate-800 overflow-x-auto shadow-inner">
                                {`curl -X POST http://localhost:${serverPort}/api/write \\
  -H "Content-Type: application/json" \\
  -d '{"address":"0xABC", "offset":"108", "property_type":"IntProperty", "value":"42"}'`}
                            </pre>
                        </div>
                    </div>
                </div>
            )}

            {/* Main Content Area */}
            <div className="flex-1 overflow-auto p-6 scrollbar-thin scrollbar-thumb-slate-700 flex flex-col items-center">
                <div className="w-full max-w-5xl flex flex-col gap-6 relative z-10">

                    {(() => {
                        if (apiGroups.length === 0) {
                            return (
                                <div className="flex flex-col items-center justify-center h-64 text-slate-500/50 border-2 border-dashed border-slate-800 rounded-2xl">
                                    <Box size={48} className="mb-4 opacity-20" />
                                    <p className="text-sm font-semibold tracking-wide uppercase">No Structured Data</p>
                                    <p className="text-xs mt-1 opacity-60">Add parameters from the Inspector panel</p>
                                </div>
                            );
                        }

                        // Group apiGroups by instanceObjectId
                        const instancesMap = new Map<string, ApiGroup[]>();
                        apiGroups.forEach(group => {
                            if (!instancesMap.has(group.instanceObjectId)) {
                                instancesMap.set(group.instanceObjectId, []);
                            }
                            instancesMap.get(group.instanceObjectId)!.push(group);
                        });

                        return Array.from(instancesMap.entries()).map(([instanceObjectId, instanceGroups]) => {
                            // Take the instanceName from the first group (they should all be the same)
                            const instanceName = instanceGroups[0].instanceName;

                            return (
                                <div key={instanceObjectId} className="bg-[#0f172a]/95 backdrop-blur-xl border border-slate-800/80 rounded-xl overflow-hidden shadow-2xl transition-all hover:border-slate-700/80">

                                    {/* Instance Header Wrapper */}
                                    <div className="p-4 border-b border-slate-800/80 flex flex-col gap-1 bg-gradient-to-r from-slate-900 to-transparent">
                                        <div className="flex justify-between items-start">
                                            <div className="flex flex-col gap-1">
                                                <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500 flex items-center gap-1.5">
                                                    <Cpu size={12} /> Target Instance
                                                </span>
                                                <div className="flex items-baseline gap-3">
                                                    <button
                                                        className="text-xl font-bold text-white tracking-wide hover:text-amber-300 transition-colors text-left"
                                                        onClick={() => copyToClipboard(instanceName)}
                                                        title="Click to copy Name"
                                                    >
                                                        {instanceName}
                                                    </button>
                                                    <span className="text-sm font-mono text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">{instanceObjectId}</span>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => {
                                                    // Remove all groups under this instance
                                                    instanceGroups.forEach(g => removeGroup(g.id));
                                                }}
                                                className="p-1.5 rounded-lg bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white transition-all shadow-sm"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Classes List */}
                                    <div className="flex flex-col p-4 gap-4 w-full">
                                        {instanceGroups.map((group) => (
                                            <div key={group.id} className="flex flex-col w-full relative">
                                                {/* Pseudo-Root Node for the Class */}
                                                <div className="flex items-center py-2 px-3 hover:bg-slate-800/40 border-b border-slate-800/30 w-full transition-all group/row cursor-default rounded-t-md">
                                                    <div className="flex-1 flex items-center min-w-0">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-slate-600 shrink-0 mr-3" />
                                                        <button
                                                            className="font-bold tracking-wide text-left text-slate-300 hover:text-amber-300 transition-colors cursor-pointer"
                                                            onClick={(e) => { e.stopPropagation(); copyToClipboard(group.classObjectName); }}
                                                            title={`Copy: ${group.classObjectName}`}
                                                        >
                                                            {group.classObjectName}
                                                        </button>

                                                        <div className="flex-1 border-b border-dashed border-slate-700/50 mx-2 opacity-50"></div>

                                                        <div className="flex items-center gap-2 opacity-60">
                                                            <span className="text-[10px] uppercase text-amber-500/70">BLUEPRINTGENERATEDCLASS</span>
                                                            <button
                                                                className="text-xs font-mono text-slate-500 hover:text-cyan-300 transition-colors cursor-pointer"
                                                                onClick={(e) => { e.stopPropagation(); copyToClipboard(group.classObjectId); }}
                                                                title={`Copy: ${group.classObjectId}`}
                                                            >{group.classObjectId}</button>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Actual properties mounted under the root */}
                                                <div className="pl-6 w-full relative mt-2">
                                                    <div className="absolute left-[17px] top-0 bottom-4 w-[1px] bg-slate-700/50"></div>
                                                    <div className="flex flex-col gap-1 pr-2">
                                                        {renderTreeNodes(Object.values(buildTree(group.parameters).children), 0, group.id)}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        });
                    })()}
                </div>
            </div>
        </div>
    );
}
