import { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Search, Plus, Copy, ChevronRight, ChevronDown, Activity, Trash2, Cpu, Edit3, Crosshair, ScanEye, X, Terminal } from 'lucide-react';
import { ObjectAnalyzerPanel } from './ObjectAnalyzerPanel';
// --- Types ---
interface InstanceSearchResult {
    instance_address: string;
    object_name: string;
}

interface InspectorHierarchyNode {
    name: string;
    type_name: string;
    address: string;
}

interface InstancePropertyInfo {
    property_name: string;
    property_type: string;
    offset: string;
    sub_type: string;
    memory_address: string;
    live_value: string;
    is_object: boolean;
    object_instance_address: string;
    object_class_address: string;
}

interface TrackedInstance {
    id: string; // address
    name: string;
    hierarchy: InspectorHierarchyNode[];
}

const globalStyles = `
  @keyframes scanline {
    0% { transform: translateY(-100%); opacity: 0; }
    50% { opacity: 0.15; }
    100% { transform: translateY(100vh); opacity: 0; }
  }
  @keyframes pulseGlow {
    0%, 100% { opacity: 0.8; }
    50% { opacity: 0.4; }
  }
  @keyframes shimmer {
    0% { background-position: -200% center; }
    100% { background-position: 200% center; }
  }
  @keyframes fadeInRight {
    from { opacity: 0; transform: translateX(8px); }
    to { opacity: 1; transform: translateX(0); }
  }
  @keyframes valuePopIn {
    0% { opacity: 0; transform: scale(0.92); }
    60% { transform: scale(1.02); }
    100% { opacity: 1; transform: scale(1); }
  }
  .value-animate { animation: valuePopIn 0.2s ease-out forwards; }
  .shimmer-text {
    background: linear-gradient(90deg, currentColor 0%, rgba(255,255,255,0.9) 45%, currentColor 55%, currentColor 100%);
    background-size: 200% auto;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .prop-row:hover .prop-addr { opacity: 1; transform: translateX(0); }
  .prop-addr { opacity: 0; transform: translateX(4px); transition: all 0.2s ease; }
`;

// --- Custom Neon Animated Toggle ---
const NeonToggle = ({ checked }: { checked: boolean }) => (
    <div className={`relative w-10 h-5 rounded-full transition-all duration-300 cursor-default shrink-0 ${checked
        ? 'bg-cyan-500/20 border border-cyan-500/60 shadow-[0_0_12px_rgba(34,211,238,0.4)]'
        : 'bg-slate-800/80 border border-slate-700/60'
        }`}>
        <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-all duration-300 shadow-md ${checked
            ? 'left-[calc(100%-18px)] bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.8)]'
            : 'left-0.5 bg-slate-500'
            }`}>
            {checked && <div className="absolute inset-0.5 rounded-full bg-white/30 blur-[1px]" />}
        </div>
    </div>
);

// --- Draggable Number Input ---
const DraggableNumberInput = ({ initialValue, isFloat }: { initialValue: string, isFloat: boolean }) => {
    const [value, setValue] = useState(initialValue);
    const [isEditing, setIsEditing] = useState(false);
    const [isDragActive, setIsDragActive] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const isDragging = useRef(false);
    const startY = useRef(0);
    const startX = useRef(0);
    const startVal = useRef(0);

    useEffect(() => { setValue(initialValue); }, [initialValue]);

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
            const sensitivity = isFloat ? 0.05 : 1;
            let newVal = startVal.current + (delta * sensitivity);
            if (!isFloat) newVal = Math.round(newVal);
            setValue(isFloat ? newVal.toFixed(3) : newVal.toString());
        };

        const handlePointerUp = () => {
            if (isDragging.current) {
                isDragging.current = false;
                setIsDragActive(false);
                document.body.style.cursor = 'default';
                window.removeEventListener('pointermove', handlePointerMove);
                window.removeEventListener('pointerup', handlePointerUp);
            }
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
    };

    return (
        <div className={`relative flex items-center w-full group/num transition-all duration-200 rounded-md overflow-hidden ${isDragActive ? 'ring-1 ring-cyan-500/40' : ''
            }`}>
            <div className={`absolute inset-0 rounded-md transition-opacity duration-200 pointer-events-none ${isEditing ? 'bg-slate-800/80 border border-cyan-500/40' : 'bg-slate-900/40 border border-slate-700/40 group-hover/num:border-slate-600/60'
                }`} />
            <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onPointerDown={handlePointerDown}
                onDoubleClick={() => { setIsEditing(true); setTimeout(() => inputRef.current?.focus(), 0); }}
                onBlur={() => setIsEditing(false)}
                onKeyDown={(e) => e.key === 'Enter' && setIsEditing(false)}
                readOnly={!isEditing}
                className="relative z-10 w-full bg-transparent px-2.5 py-1 text-xs font-mono text-slate-200 focus:outline-none cursor-ew-resize select-none"
            />
            <div className="relative z-10 pr-2 shrink-0">
                {isEditing
                    ? <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_6px_rgba(34,211,238,0.8)]" />
                    : <Edit3 size={9} className="text-slate-600 group-hover/num:text-slate-400 transition-colors" />
                }
            </div>
        </div>
    );
};

export function Inspector() {
    // --- State: Left Column (Instance Hunter) ---
    const [isHunterOpen, setIsHunterOpen] = useState(false);
    const [hunterQuery, setHunterQuery] = useState('');
    const [hunterResults, setHunterResults] = useState<InstanceSearchResult[]>([]);
    const [isHunting, setIsHunting] = useState(false);
    const [huntTimeMs, setHuntTimeMs] = useState(0);

    const [isAnalyzerOpen, setIsAnalyzerOpen] = useState(false);

    // --- State: Middle Column (Tracked Instances) ---
    const [addInstanceInput, setAddInstanceInput] = useState('');
    const [isAdding, setIsAdding] = useState(false);
    const [trackedInstances, setTrackedInstances] = useState<TrackedInstance[]>([]);
    const [activeInstanceId, setActiveInstanceId] = useState<string | null>(null);

    // --- State: Right Column (Tree View) ---
    // Maps: "instance_addr:class_addr" -> expanded
    const [expandedClasses, setExpandedClasses] = useState<Record<string, boolean>>({});
    // Maps: "instance_addr:class_addr" -> properties
    const [classProperties, setClassProperties] = useState<Record<string, InstancePropertyInfo[]>>({});
    const [isLoadingNode, setIsLoadingNode] = useState<Record<string, boolean>>({});

    // --- Handlers: Left Column (Instance Hunter) ---
    const formatTime = (ms: number) => {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        const milliseconds = ms % 1000;
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
    };

    const handleHunt = async () => {
        if (!hunterQuery.trim()) return;
        setIsHunting(true);
        setHuntTimeMs(0);
        setHunterResults([]);

        const startTime = Date.now();
        let animationFrameId: number;

        const updateTimer = () => {
            setHuntTimeMs(Date.now() - startTime);
            animationFrameId = requestAnimationFrame(updateTimer);
        };
        animationFrameId = requestAnimationFrame(updateTimer);

        try {
            const results = await invoke<InstanceSearchResult[]>('search_object_instances', { objectAddress: hunterQuery.trim() });
            setHunterResults(results);
        } catch (error) {
            console.error("Hunt failed:", error);
            setHunterResults([]);
        } finally {
            cancelAnimationFrame(animationFrameId);
            setHuntTimeMs(Date.now() - startTime);
            setIsHunting(false);
        }
    };

    const copyToClipboard = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
        } catch (err) { }
    };

    // --- Handlers: Middle Column (Add Inspector) ---
    const handleAddInstance = async (addressOverride?: string) => {
        const addr = addressOverride || addInstanceInput.trim();
        if (!addr) return;

        // Prevent duplicate adds
        if (trackedInstances.some(t => t.id === addr)) {
            setActiveInstanceId(addr);
            return;
        }

        setIsAdding(true);
        try {
            const hierarchy = await invoke<InspectorHierarchyNode[]>('add_inspector', { instanceAddress: addr });
            if (hierarchy.length > 0) {
                const newInst: TrackedInstance = {
                    id: addr,
                    name: hierarchy[0].name,
                    hierarchy
                };
                setTrackedInstances(prev => [newInst, ...prev]);
                if (!activeInstanceId) setActiveInstanceId(newInst.id);
                setAddInstanceInput('');
            }
        } catch (error) {
            console.error("Failed to add instance:", error);
        } finally {
            setIsAdding(false);
        }
    };

    const handleRemoveInstance = (id: string) => {
        setTrackedInstances(prev => prev.filter(t => t.id !== id));
        if (activeInstanceId === id) setActiveInstanceId(null);
    };

    // --- Handlers: Right Column (Tree View) ---
    const toggleClassNode = async (instanceAddr: string, classAddr: string) => {
        const nodeKey = `${instanceAddr}:${classAddr}`;
        const isCurrentlyExpanded = expandedClasses[nodeKey];

        setExpandedClasses(prev => ({ ...prev, [nodeKey]: !isCurrentlyExpanded }));

        if (!isCurrentlyExpanded && !classProperties[nodeKey]) {
            setIsLoadingNode(prev => ({ ...prev, [nodeKey]: true }));
            try {
                const props = await invoke<InstancePropertyInfo[]>('get_instance_details', {
                    instanceAddress: instanceAddr,
                    classAddress: classAddr
                });
                setClassProperties(prev => ({ ...prev, [nodeKey]: props }));
            } catch (error) {
                console.error("Failed to fetch class properties:", error);
            } finally {
                setIsLoadingNode(prev => ({ ...prev, [nodeKey]: false }));
            }
        }
    };

    const togglePropertyNode = async (prop: InstancePropertyInfo) => {
        const nodeKey = `${prop.object_instance_address}:${prop.object_class_address}`;
        const isCurrentlyExpanded = expandedClasses[nodeKey];
        setExpandedClasses(prev => ({ ...prev, [nodeKey]: !isCurrentlyExpanded }));

        if (!isCurrentlyExpanded && !classProperties[nodeKey]) {
            setIsLoadingNode(prev => ({ ...prev, [nodeKey]: true }));
            try {
                const typeLower = prop.property_type.toLowerCase();
                let props: InstancePropertyInfo[] = [];

                if (typeLower.includes('array') || typeLower.includes('map') || typeLower.includes('set')) {
                    // Extract count from "Elements: 10"
                    const countStr = prop.live_value.replace(/[^0-9]/g, '');
                    const count = parseInt(countStr) || 0;

                    props = await invoke<InstancePropertyInfo[]>('get_array_elements', {
                        arrayAddress: prop.object_instance_address,
                        innerType: prop.sub_type || typeLower.replace('property', ''),
                        count: count
                    });
                } else {
                    props = await invoke<InstancePropertyInfo[]>('get_instance_details', {
                        instanceAddress: prop.object_instance_address,
                        classAddress: prop.object_class_address
                    });
                }

                setClassProperties(prev => ({ ...prev, [nodeKey]: props }));
            } catch (error) {
                console.error("Failed to fetch property children:", error);
            } finally {
                setIsLoadingNode(prev => ({ ...prev, [nodeKey]: false }));
            }
        }
    };

    const activeInstance = trackedInstances.find(t => t.id === activeInstanceId);

    // --- Renderers ---

    const renderProperties = (properties: InstancePropertyInfo[], depth: number) => {
        return (
            <div className={`flex flex-col relative mt-1 ${depth > 0 ? 'pl-6' : ''}`}>
                {depth > 0 && <div className="absolute left-[10px] top-0 bottom-4 w-[1px] bg-slate-700"></div>}

                {properties.map((prop, pIdx) => {
                    const isExpandable = prop.is_object && prop.object_instance_address !== "0x0" && prop.object_instance_address !== "";
                    const nodeKey = `${prop.object_instance_address}:${prop.object_class_address}`;
                    const isExpanded = expandedClasses[nodeKey];
                    const isLoading = isLoadingNode[nodeKey];
                    const childProps = classProperties[nodeKey] || [];

                    return (
                        <div key={pIdx} className="flex flex-col">
                            <div className="prop-row flex items-center gap-3 py-1.5 px-2 hover:bg-slate-800/40 rounded group transition-all duration-150 border border-transparent hover:border-slate-700/30">
                                {/* Expand Button for Object */}
                                {isExpandable ? (
                                    <button onClick={() => togglePropertyNode(prop)} className="text-slate-400 hover:text-white w-4 flex justify-center shrink-0">
                                        {isLoading ? <Activity size={10} className="animate-spin text-cyan-400" /> : (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
                                    </button>
                                ) : (
                                    <div className="w-4 shrink-0"></div>
                                )}

                                {/* Offset Tag */}
                                <span className="text-[10px] w-12 text-right font-mono shrink-0">
                                    <span className="text-slate-500">+</span><span className="text-slate-400/80">{prop.offset}</span>
                                </span>

                                <div className="flex-1 flex items-center gap-3">
                                    {/* Type Badge */}
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

                                    {/* Name */}
                                    <span className="text-[12px] text-slate-100/90 font-medium tracking-tight truncate flex-1" title={prop.property_name}>{prop.property_name}</span>
                                </div>

                                <div className="flex items-center gap-2 shrink-0 justify-end w-[230px]">
                                    {/* Hover Address Badge */}
                                    <button
                                        className="prop-addr flex items-center gap-1 text-[10px] font-mono text-slate-600 hover:text-cyan-400 transition-colors"
                                        onClick={(e) => { e.stopPropagation(); copyToClipboard(prop.memory_address); }}
                                        title={`Copy: ${prop.memory_address}`}
                                    >
                                        <Copy size={8} />
                                        <span>{prop.memory_address}</span>
                                    </button>

                                    {/* Value Widget */}
                                    {prop.property_type.toLowerCase().includes('bool') ? (
                                        <NeonToggle checked={prop.live_value === 'True'} />
                                    ) : prop.is_object ? (
                                        <button
                                            className="w-[160px] h-[26px] flex items-center bg-cyan-950/30 border border-cyan-900/40 hover:border-cyan-700/60 rounded-lg px-2.5 text-xs font-mono text-cyan-300/80 hover:text-cyan-100 transition-all duration-200 shadow-[inset_0_0_10px_rgba(8,145,178,0.1)] hover:shadow-[inset_0_0_14px_rgba(34,211,238,0.15)] cursor-pointer overflow-hidden"
                                            title={prop.object_instance_address || prop.memory_address}
                                            onClick={(e) => { e.stopPropagation(); copyToClipboard(prop.object_instance_address || prop.memory_address); }}
                                        >
                                            <span className="min-w-0 truncate block">{prop.object_instance_address || prop.memory_address}</span>
                                        </button>
                                    ) : prop.property_type.toLowerCase().includes('name') || prop.property_type.toLowerCase().includes('str') ? (
                                        <button
                                            className="w-[160px] h-[26px] flex items-center bg-amber-900/10 border border-amber-800/20 hover:border-amber-600/40 rounded-lg px-2.5 text-xs text-amber-200/70 hover:text-amber-100 transition-all duration-200 cursor-pointer overflow-hidden"
                                            title={prop.live_value}
                                            onClick={(e) => { e.stopPropagation(); copyToClipboard(prop.live_value); }}
                                        >
                                            <span className="min-w-0 truncate block font-mono">{prop.live_value || '—'}</span>
                                        </button>
                                    ) : (
                                        <div className="w-[160px]">
                                            <DraggableNumberInput
                                                initialValue={prop.live_value}
                                                isFloat={prop.property_type.toLowerCase().includes('float') || prop.property_type.toLowerCase().includes('double')}
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Recursive Children Dropdown */}
                            {isExpandable && isExpanded && renderProperties(childProps, depth + 1)}
                        </div>
                    );
                })}
                {properties.length === 0 && (
                    <div className="py-2 pl-12 text-xs text-slate-600 italic">No resolvable properties</div>
                )}
            </div>
        );
    };

    return (
        <div className="flex w-full h-full bg-[#0a0f18] text-slate-300 font-sans relative overflow-hidden">
            <style dangerouslySetInnerHTML={{ __html: globalStyles }} />

            {/* Ambient Background Glows */}
            <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-cyan-900/20 blur-[120px] pointer-events-none" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-900/10 blur-[100px] pointer-events-none" />

            {/* Scanline overlay */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-10 mix-blend-overlay z-50">
                <div className="w-full h-[2px] bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.8)] animate-[scanline_4s_linear_infinite]" />
            </div>

            {/* ───── Left Icon Bar Toggle ───── */}
            <div className="w-12 bg-slate-[950] border-r border-slate-800/80 flex flex-col items-center py-4 z-40 shrink-0 shadow-[4px_0_15px_rgba(0,0,0,0.3)] gap-3 relative">

                {/* 1. Object Analyzer Tool */}
                <button
                    onClick={() => {
                        setIsAnalyzerOpen(!isAnalyzerOpen);
                        if (!isAnalyzerOpen) setIsHunterOpen(false);
                    }}
                    className={`p-2.5 rounded-lg transition-all relative group ${isAnalyzerOpen ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 shadow-[0_0_15px_rgba(34,211,238,0.2)]' : 'text-slate-500 hover:text-cyan-400 hover:bg-slate-800'}`}
                    title="Object Analyzer"
                >
                    {isAnalyzerOpen && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-1/2 bg-cyan-400 rounded-r-md shadow-[0_0_8px_rgba(34,211,238,0.8)]" />}
                    <Terminal className={`w-5 h-5 transition-transform ${isAnalyzerOpen ? 'animate-[pulseGlow_3s_ease-in-out_infinite]' : 'group-hover:scale-110'}`} />
                </button>

                {/* 2. Instance Hunter Tool */}
                <button
                    onClick={() => {
                        setIsHunterOpen(!isHunterOpen);
                        if (!isHunterOpen) setIsAnalyzerOpen(false);
                    }}
                    className={`p-2.5 rounded-lg transition-all relative group ${isHunterOpen ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 shadow-[0_0_15px_rgba(34,211,238,0.2)]' : 'text-slate-500 hover:text-cyan-400 hover:bg-slate-800'}`}
                    title="Instance Hunter"
                >
                    {isHunterOpen && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-1/2 bg-cyan-400 rounded-r-md shadow-[0_0_8px_rgba(34,211,238,0.8)]" />}
                    <Crosshair className={`w-5 h-5 transition-transform ${isHunterOpen ? 'animate-[pulseGlow_3s_ease-in-out_infinite]' : 'group-hover:scale-110'}`} />
                </button>
            </div>

            {/* L0: Analyzer Panel */}
            <ObjectAnalyzerPanel isOpen={isAnalyzerOpen} onClose={() => setIsAnalyzerOpen(false)} />

            {/* L1: Instance Hunter (Collapsible Left Panel) */}
            <div className={`flex flex-col bg-[#0f172a]/95 backdrop-blur-xl relative z-10 shrink-0 transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)] overflow-hidden border-r border-slate-800/80 
                ${isHunterOpen ? 'w-[320px]' : 'w-0 border-r-0 opacity-0'}`
            }
            >
                <div className="p-4 border-b border-slate-800/80 shrink-0 w-[320px]">
                    <div className="flex items-center gap-2 mb-4">
                        <Crosshair className="w-4 h-4 text-cyan-400" />
                        <span className="text-xs font-black uppercase tracking-[0.2em] text-slate-200 flex-1">Instance Hunter</span>
                        <button onClick={() => setIsHunterOpen(false)} className="text-slate-500 hover:text-rose-400 transition-colors p-1 rounded-md hover:bg-rose-500/10">
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1.5 block">Object Address</label>
                    <div className="flex filter drop-shadow-md">
                        <input
                            type="text"
                            placeholder="ex: 0x1A2B3C4D"
                            value={hunterQuery}
                            onChange={(e) => setHunterQuery(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleHunt()}
                            className="w-full bg-slate-900 border border-slate-700/50 rounded-l-lg px-2.5 py-2 text-xs text-white focus:outline-none focus:border-cyan-500/50 focus:bg-slate-900/90 transition-all placeholder:text-slate-600 font-mono"
                        />
                        <button
                            onClick={handleHunt}
                            disabled={isHunting}
                            className="bg-slate-800 hover:bg-cyan-600 border border-l-0 border-slate-700/50 rounded-r-lg px-3 text-white transition-colors flex items-center justify-center disabled:opacity-50 shadow-inner"
                        >
                            {isHunting ? <Activity size={14} className="animate-spin text-cyan-300" /> : <Search size={14} />}
                        </button>
                    </div>
                    {/* Status block */}
                    <div className="flex justify-between items-center mt-3 text-[10px] uppercase font-bold tracking-widest text-slate-500">
                        <span className="font-mono w-24">Time: {huntTimeMs > 0 || isHunting ? formatTime(huntTimeMs) : '--'}</span>
                        <span>Found: <span className="text-cyan-400">{hunterResults.length}</span></span>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1.5 w-[320px] scrollbar-thin scrollbar-thumb-slate-700">
                    {hunterResults.map((res, i) => (
                        <div key={i} className="group relative flex flex-col bg-slate-800/40 border border-slate-700/40 rounded-md p-2.5 hover:bg-slate-800 hover:border-cyan-500/30 transition-all">
                            <span className="text-[11px] font-semibold text-slate-100 truncate max-w-[200px]" title={res.object_name}>{res.object_name}</span>
                            <span className="text-[10px] text-slate-400 font-mono mt-0.5">{res.instance_address}</span>

                            <div className="absolute top-1/2 -translate-y-1/2 right-2 opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
                                <button
                                    onClick={() => handleAddInstance(res.instance_address)}
                                    className="p-1.5 bg-slate-700 hover:bg-blue-500 shadow-md rounded text-slate-200 hover:text-white transition-colors"
                                    title="Add to Inspector"
                                >
                                    <Plus size={12} />
                                </button>
                                <button
                                    onClick={() => copyToClipboard(res.instance_address)}
                                    className="p-1.5 bg-slate-700 hover:bg-emerald-500 shadow-md rounded text-slate-200 hover:text-white transition-colors"
                                    title="Copy Address"
                                >
                                    <Copy size={12} />
                                </button>
                            </div>
                        </div>
                    ))}
                    {hunterResults.length === 0 && !isHunting && huntTimeMs > 0 && (
                        <div className="flex flex-col items-center justify-center h-48 text-slate-600 gap-3">
                            <Search className="w-8 h-8 opacity-20" />
                            <div className="text-[10px] uppercase font-mono tracking-widest font-bold">NO MATCHES FOUND</div>
                        </div>
                    )}
                </div>
            </div>

            {/* L2: Inspector List (Middle Panel) */}
            <div className="w-64 flex flex-col bg-slate-950/40 backdrop-blur-md border-r border-slate-800/80 shrink-0 z-10">
                <div className="p-3 border-b border-slate-800/80 flex items-center justify-between shrink-0">
                    <span className="text-sm font-bold tracking-wide uppercase text-slate-200">Inspector List</span>
                </div>

                <div className="p-3 shrink-0">
                    <div className="flex filter drop-shadow-md">
                        <input
                            type="text"
                            placeholder="Add Instance 0x..."
                            value={addInstanceInput}
                            onChange={(e) => setAddInstanceInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddInstance()}
                            className="w-full bg-slate-900 border border-slate-700/50 rounded-l-md px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500/50 focus:bg-slate-900/90 transition-all placeholder:text-slate-600 font-mono"
                        />
                        <button
                            onClick={() => handleAddInstance()}
                            disabled={isAdding}
                            className="bg-slate-800 hover:bg-cyan-600 border border-l-0 border-slate-700/50 rounded-r-md px-3 text-white transition-colors flex items-center justify-center disabled:opacity-50 shadow-inner"
                        >
                            {isAdding ? <Activity size={14} className="animate-spin text-cyan-300" /> : <Plus size={14} />}
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {trackedInstances.map(inst => (
                        <div
                            key={inst.id}
                            onClick={() => setActiveInstanceId(inst.id)}
                            className={`group flex items-center justify-between p-2 rounded-md cursor-pointer transition-all border
                                ${activeInstanceId === inst.id
                                    ? 'bg-cyan-500/10 border-cyan-500/50 shadow-[inset_0_0_10px_rgba(34,211,238,0.1)]'
                                    : 'bg-transparent border-transparent hover:bg-slate-800/50 hover:border-slate-700'
                                }
                            `}
                        >
                            <div className="flex flex-col truncate pr-2">
                                <span className={`text-xs font-semibold truncate ${activeInstanceId === inst.id ? 'text-cyan-400' : 'text-slate-300'}`}>
                                    {inst.name}
                                </span>
                                <span className="text-[10px] font-mono text-slate-500">{inst.id}</span>
                            </div>

                            <button
                                onClick={(e) => { e.stopPropagation(); handleRemoveInstance(inst.id); }}
                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-rose-500/20 hover:text-rose-400 text-slate-500 rounded transition-all"
                            >
                                <Trash2 size={12} />
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            {/* L3: Memory Tree View (Main Stage) */}
            <div className="flex-1 flex flex-col bg-slate-950 relative z-10 shadow-[inner_20px_0_40px_rgba(0,0,0,0.5)] border-l border-slate-900 min-w-0">
                {activeInstance ? (
                    <div className="flex-1 overflow-auto p-4 scrollbar-thin scrollbar-thumb-slate-700 bg-[#0a0f18]/80 backdrop-blur">
                        {/* Instance Header Banner */}
                        <div className="mb-6 pb-2 border-b border-slate-700/50 flex flex-col gap-1">
                            <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500 flex items-center gap-1.5"><Cpu size={12} /> Target Instance</span>
                            <div className="flex items-baseline gap-3">
                                <button
                                    className="text-xl font-bold text-white tracking-wide hover:text-amber-300 hover:underline transition-colors text-left"
                                    onClick={() => copyToClipboard(activeInstance.name)}
                                    title="Click to copy Name"
                                >
                                    {activeInstance.name}
                                </button>
                                <span className="text-sm font-mono text-cyan-500 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">{activeInstance.id}</span>
                            </div>
                        </div>

                        {/* Hierarchical Tree Render */}
                        <div className="flex flex-col gap-1 text-sm font-mono">
                            {activeInstance.hierarchy.map((classNode) => {
                                const nodeKey = `${activeInstance.id}:${classNode.address}`;
                                const isExpanded = expandedClasses[nodeKey];
                                const isLoading = isLoadingNode[nodeKey];
                                const props = classProperties[nodeKey] || [];

                                return (
                                    <div key={nodeKey} className="flex flex-col">
                                        {/* Class Node Title row */}
                                        <div
                                            className="flex items-center gap-2 p-1.5 hover:bg-slate-800/60 rounded cursor-pointer group transition-colors select-none"
                                            onClick={() => toggleClassNode(activeInstance.id, classNode.address)}
                                        >
                                            <div className="flex justify-center items-center w-5 h-5 text-slate-400 group-hover:text-white transition-colors">
                                                {isLoading ? <Activity size={12} className="animate-spin text-cyan-400" />
                                                    : (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
                                            </div>

                                            {/* Glow bullet for classes */}
                                            <div className={`w-1.5 h-1.5 rounded-full ${isExpanded ? 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]' : 'bg-slate-600'}`}></div>

                                            <button
                                                className={`font-bold tracking-wide text-left hover:text-amber-300 transition-colors cursor-pointer ${isExpanded ? 'text-white' : 'text-slate-300'}`}
                                                onClick={(e) => { e.stopPropagation(); copyToClipboard(classNode.name); }}
                                                title={`Copy: ${classNode.name}`}
                                            >
                                                {classNode.name}
                                            </button>

                                            <div className="flex-1 border-b border-dashed border-slate-700/50 mx-2 opacity-50"></div>

                                            <div className="flex items-center gap-2 opacity-60">
                                                <span className="text-[10px] uppercase text-amber-500/70">{classNode.type_name}</span>
                                                <button
                                                    className="text-xs font-mono text-slate-500 hover:text-cyan-300 transition-colors cursor-pointer"
                                                    onClick={(e) => { e.stopPropagation(); copyToClipboard(classNode.address); }}
                                                    title={`Copy: ${classNode.address}`}
                                                >{classNode.address}</button>
                                            </div>
                                        </div>

                                        {/* Properties Block */}
                                        {isExpanded && renderProperties(props, 1)}
                                    </div>
                                );
                            })}
                        </div>

                    </div>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-500/50">
                        <ScanEye size={48} className="mb-4 opacity-20" />
                        <p className="text-sm font-semibold tracking-wide uppercase">No Instance Selected</p>
                        <p className="text-xs mt-1 opacity-60">Hunt an instance or add via memory address</p>
                    </div>
                )}
            </div>

        </div>
    );
}
