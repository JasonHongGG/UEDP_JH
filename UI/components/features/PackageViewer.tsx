import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Search } from 'lucide-react';

interface PackageInfo {
    name: string;
    object_count: number;
}

interface ObjectSummary {
    address: number;
    name: string;
    full_name: string;
    type_name: string;
}

interface InheritanceItem {
    name: string;
    address: number;
}

interface ObjectPropertyInfo {
    property_name: string;
    property_type: string;
    offset: string;
    sub_type: string;
    sub_type_address: number;
}

interface EnumValueItem {
    name: string;
    value: number;
}

interface FunctionParamInfo {
    param_type: string;
    param_name: string;
    type_address: number;
}

interface DetailedObjectInfo {
    address: number;
    function_address: number;
    function_offset: string;
    name: string;
    full_name: string;
    type_name: string;
    inheritance: InheritanceItem[];
    properties: ObjectPropertyInfo[];
    enum_values: EnumValueItem[];
    enum_underlying_type: string;
    function_owner: string;
    function_owner_address: number;
    function_return_type: string;
    function_return_address: number;
    function_params: FunctionParamInfo[];
    prop_size: number;
}

// ═══ Tab type for the inspector panel ═══
interface InspectorTab {
    address: number;
    name: string;
    type_name: string;
    detail: DetailedObjectInfo | null;
    loading: boolean;
}

export function PackageViewer() {
    const [packages, setPackages] = useState<PackageInfo[]>([]);
    const [filteredPackages, setFilteredPackages] = useState<PackageInfo[]>([]);
    const [packageSearch, setPackageSearch] = useState("");
    const [selectedPackage, setSelectedPackage] = useState<string | null>(null);

    const [objects, setObjects] = useState<ObjectSummary[]>([]);
    const [filteredObjects, setFilteredObjects] = useState<ObjectSummary[]>([]);
    const [objectSearch, setObjectSearch] = useState("");
    const [selectedCategory, setSelectedCategory] = useState<"Class" | "Struct" | "Enum" | "Function">("Class");

    const [tabs, setTabs] = useState<InspectorTab[]>([]);
    const [activeTabIndex, setActiveTabIndex] = useState<number>(-1);

    const activeTab = activeTabIndex >= 0 && activeTabIndex < tabs.length ? tabs[activeTabIndex] : null;

    // ═══ Open/focus a tab ═══
    const handleObjectClick = async (obj: ObjectSummary) => {
        const existingIndex = tabs.findIndex(t => t.address === obj.address);
        if (existingIndex >= 0) {
            setActiveTabIndex(existingIndex);
            return;
        }

        const newTab: InspectorTab = {
            address: obj.address,
            name: obj.name,
            type_name: obj.type_name,
            detail: null,
            loading: true,
        };
        const newTabs = [...tabs, newTab];
        setTabs(newTabs);
        setActiveTabIndex(newTabs.length - 1);

        // Fetch details from backend
        try {
            const detail = await invoke<DetailedObjectInfo>('get_object_details', { address: obj.address });
            setTabs(prev => prev.map(t => t.address === obj.address ? { ...t, detail, loading: false } : t));
        } catch (err) {
            console.error("Failed to fetch object details:", err);
            setTabs(prev => prev.map(t => t.address === obj.address ? { ...t, loading: false } : t));
        }
    };

    // ═══ Navigate to referenced object (cross-reference) ═══
    const handleNavigateToObject = async (address: number) => {
        if (!address || address === 0) return;
        const existingIndex = tabs.findIndex(t => t.address === address);
        if (existingIndex >= 0) {
            setActiveTabIndex(existingIndex);
            return;
        }
        // Create a placeholder tab and fetch details
        const newTab: InspectorTab = {
            address,
            name: `0x${address.toString(16).toUpperCase()}`,
            type_name: "...",
            detail: null,
            loading: true,
        };
        const newTabs = [...tabs, newTab];
        setTabs(newTabs);
        setActiveTabIndex(newTabs.length - 1);

        try {
            const detail = await invoke<DetailedObjectInfo>('get_object_details', { address });
            setTabs(prev => prev.map(t => t.address === address ? { ...t, name: detail.name, type_name: detail.type_name, detail, loading: false } : t));
        } catch (err) {
            console.error("Failed to navigate to object:", err);
            setTabs(prev => prev.map(t => t.address === address ? { ...t, loading: false } : t));
        }
    };

    const handleCloseTab = (index: number, e: React.MouseEvent) => {
        e.stopPropagation();
        const newTabs = [...tabs];
        newTabs.splice(index, 1);
        setTabs(newTabs);
        if (newTabs.length === 0) {
            setActiveTabIndex(-1);
        } else if (activeTabIndex >= index) {
            setActiveTabIndex(Math.max(0, activeTabIndex - 1));
        }
    };

    // ═══ Data loading: fetch on mount + on window focus (only if empty) ═══
    const loadPackages = useCallback(() => {
        invoke<PackageInfo[]>('get_packages').then(pkgs => {
            if (pkgs.length > 0) {
                setPackages(pkgs);
                setFilteredPackages(pkgs);
            }
        }).catch(err => console.error("Failed to load packages", err));
    }, []);

    useEffect(() => {
        // Load immediately on mount
        loadPackages();

        // Also listen for window focus to load after parse completes
        const win = getCurrentWindow();
        let unlisten: (() => void) | null = null;
        win.onFocusChanged(({ payload: focused }) => {
            if (focused) loadPackages();
        }).then(fn => { unlisten = fn; });

        return () => { if (unlisten) unlisten(); };
    }, [loadPackages]);

    useEffect(() => {
        if (!packageSearch) {
            setFilteredPackages(packages);
        } else {
            const s = packageSearch.toLowerCase();
            setFilteredPackages(packages.filter(p => p.name.toLowerCase().includes(s)));
        }
    }, [packageSearch, packages]);

    useEffect(() => {
        if (selectedPackage) {
            invoke<ObjectSummary[]>('get_objects', { packageName: selectedPackage, category: selectedCategory })
                .then(objs => { setObjects(objs); setFilteredObjects(objs); })
                .catch(err => console.error("Failed to load objects", err));
        } else {
            setObjects([]);
            setFilteredObjects([]);
        }
    }, [selectedPackage, selectedCategory]);

    useEffect(() => {
        if (!objectSearch) {
            setFilteredObjects(objects);
        } else {
            const s = objectSearch.toLowerCase();
            setFilteredObjects(objects.filter(o => o.name.toLowerCase().includes(s)));
        }
    }, [objectSearch, objects]);

    // ═══════════════════════════ RENDER ═══════════════════════════

    return (
        <div className="flex w-full h-full text-slate-300 overflow-hidden bg-slate-900">
            {/* ───── Column 1: Packages ───── */}
            <div className="w-[22%] min-w-[220px] flex flex-col border-r border-slate-700/60 bg-slate-900/60">
                <div className="px-3 py-2.5 border-b border-slate-700/60 text-xs font-bold uppercase tracking-wider text-slate-400 bg-slate-800/60">
                    {filteredPackages.length} Package{filteredPackages.length !== 1 ? 's' : ''}
                </div>
                <div className="flex-1 overflow-y-auto p-1.5 space-y-px custom-scrollbar">
                    {filteredPackages.map(pkg => (
                        <button
                            key={pkg.name}
                            onClick={() => setSelectedPackage(pkg.name)}
                            className={`w-full text-left px-2.5 py-1.5 text-[13px] rounded transition-colors flex justify-between items-center ${selectedPackage === pkg.name
                                ? 'bg-blue-600/40 text-white'
                                : 'hover:bg-slate-700/40 text-slate-400'
                                }`}
                        >
                            <span className="truncate">{pkg.name.replace('/Script/', '')}</span>
                            <span className="text-[10px] text-slate-500 ml-2 shrink-0">{pkg.object_count}</span>
                        </button>
                    ))}
                </div>
                <div className="p-2 border-t border-slate-700/60 bg-slate-800/50">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-slate-500" />
                        <input
                            type="text"
                            placeholder="Search Package"
                            value={packageSearch}
                            onChange={e => setPackageSearch(e.target.value)}
                            className="w-full bg-slate-900/60 border border-slate-600/50 rounded text-xs py-1.5 pl-8 pr-3 outline-none focus:border-blue-500/60 transition-colors"
                        />
                    </div>
                </div>
            </div>

            {/* ───── Column 2: Objects ───── */}
            <div className="w-[22%] min-w-[220px] flex flex-col border-r border-slate-700/60 bg-slate-900/60">
                <div className="flex bg-slate-800/60 border-b border-slate-700/60">
                    {(['Class', 'Struct', 'Enum', 'Function'] as const).map(cat => (
                        <button
                            key={cat}
                            onClick={() => setSelectedCategory(cat)}
                            className={`flex-1 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors ${selectedCategory === cat
                                ? 'text-blue-400 border-b-2 border-blue-500 bg-blue-500/5'
                                : 'text-slate-500 hover:text-slate-300'
                                }`}
                        >
                            {cat}
                        </button>
                    ))}
                </div>
                <div className="px-3 py-2 border-b border-slate-700/60 text-xs font-bold uppercase tracking-wider text-slate-400 bg-slate-800/40">
                    {filteredObjects.length} {selectedCategory}{filteredObjects.length !== 1 ? (selectedCategory === 'Class' ? 'es' : 's') : ''}
                </div>
                <div className="flex-1 overflow-y-auto p-1.5 space-y-px custom-scrollbar">
                    {filteredObjects.length === 0 && selectedPackage ? (
                        <div className="text-center py-6 text-xs text-slate-600">No {selectedCategory.toLowerCase()}es found</div>
                    ) : null}
                    {filteredObjects.map(obj => (
                        <button
                            key={obj.address}
                            onClick={() => handleObjectClick(obj)}
                            className={`w-full text-left px-2.5 py-1.5 text-[13px] rounded transition-colors ${activeTab?.address === obj.address
                                ? 'bg-blue-600/40 text-white'
                                : 'hover:bg-slate-700/40 text-slate-400'
                                }`}
                        >
                            <div className="truncate" title={obj.full_name}>{obj.name}</div>
                        </button>
                    ))}
                </div>
                <div className="p-2 border-t border-slate-700/60 bg-slate-800/50">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-slate-500" />
                        <input
                            type="text"
                            placeholder={`Search ${selectedCategory}`}
                            value={objectSearch}
                            onChange={e => setObjectSearch(e.target.value)}
                            className="w-full bg-slate-900/60 border border-slate-600/50 rounded text-xs py-1.5 pl-8 pr-3 outline-none focus:border-blue-500/60 transition-colors"
                        />
                    </div>
                </div>
            </div>

            {/* ───── Column 3: Inspector ───── */}
            <div className="flex-1 overflow-hidden flex flex-col bg-slate-950/40">
                {tabs.length > 0 ? (
                    <>
                        {/* Tab bar */}
                        <div className="flex items-end gap-px px-2 pt-1.5 border-b border-slate-700/60 bg-slate-800/30 overflow-x-auto custom-scrollbar shrink-0">
                            {tabs.map((tab, idx) => (
                                <button
                                    key={`${tab.address}-${idx}`}
                                    onClick={() => setActiveTabIndex(idx)}
                                    onAuxClick={(e) => { if (e.button === 1) handleCloseTab(idx, e); }}
                                    className={`group flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-t-md border border-b-0 max-w-[180px] shrink-0 transition-all ${activeTabIndex === idx
                                        ? 'bg-slate-900 text-white border-slate-600'
                                        : 'bg-slate-800/50 text-slate-500 border-transparent hover:text-slate-300 hover:bg-slate-800'
                                        }`}
                                >
                                    <span className="truncate">{tab.name}</span>
                                    <span
                                        className="w-4 h-4 rounded-sm flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-rose-500/20 hover:text-rose-400 transition-all text-[14px] leading-none"
                                        onClick={(e) => handleCloseTab(idx, e)}
                                    >
                                        ×
                                    </span>
                                </button>
                            ))}
                        </div>

                        {/* Detail content */}
                        {activeTab && (
                            <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
                                {activeTab.loading ? (
                                    <div className="flex items-center justify-center h-full text-slate-500 text-sm">
                                        Loading...
                                    </div>
                                ) : activeTab.detail ? (
                                    <DetailView
                                        detail={activeTab.detail}
                                        onNavigate={handleNavigateToObject}
                                    />
                                ) : (
                                    <div className="flex items-center justify-center h-full text-rose-400 text-sm">
                                        Failed to load object data.
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                ) : (
                    <div className="flex items-center justify-center h-full text-slate-600 text-sm">
                        Select an object to inspect
                    </div>
                )}
            </div>
        </div>
    );
}

// ═══════════════════════════ DETAIL VIEW COMPONENT ═══════════════════════════

function DetailView({ detail, onNavigate }: { detail: DetailedObjectInfo; onNavigate: (addr: number) => void }) {
    const typeLower = detail.type_name.toLowerCase();
    const isClass = typeLower.includes("class") || typeLower.includes("struct");
    const isEnum = typeLower.startsWith("enum") || typeLower === "userenum";
    const isFunction = typeLower.includes("function");

    return (
        <div className="flex flex-col gap-4 text-[13px]">
            {/* ─── Header ─── */}
            <div className="flex flex-col gap-1 font-mono text-xs border-l-4 border-blue-500 pl-3 pb-2">
                <Row label="Address" value={`0x${detail.address.toString(16).toUpperCase()}`} />
                {isFunction && detail.function_offset && (
                    <Row label="ExecAddr" value={detail.function_offset} className="text-amber-400" />
                )}
                <Row label="Type" value={detail.type_name} className="text-blue-400" />
                <Row label="Name" value={detail.name} className="text-emerald-400 font-bold" />
                <Row label="FullName" value={detail.full_name} className="text-slate-500 break-all" />

                {isClass && detail.prop_size > 0 && (
                    <Row label="Size" value={`0x${detail.prop_size.toString(16).toUpperCase()} (${detail.prop_size})`} className="text-orange-400" />
                )}
            </div>

            {/* ─── Inheritance ─── */}
            {detail.inheritance.length > 0 && (
                <div>
                    <SectionHeader title="Inheritance" />
                    <div className="flex items-center gap-1 flex-wrap mt-1">
                        {detail.inheritance.map((item, i) => (
                            <span key={i} className="flex items-center gap-1">
                                <button
                                    onClick={() => onNavigate(item.address)}
                                    className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer text-xs"
                                >
                                    {item.name}
                                </button>
                                {i < detail.inheritance.length - 1 && <span className="text-slate-600 text-xs">→</span>}
                            </span>
                        ))}
                        <span className="text-slate-600 text-xs">→</span>
                        <span className="text-white text-xs font-bold">{detail.name}</span>
                    </div>
                </div>
            )}

            {/* ─── Class/Struct: Properties Table ─── */}
            {isClass && detail.properties.length > 0 && (
                <div>
                    <SectionHeader title={`Properties (${detail.properties.length})`} />
                    <table className="w-full text-xs font-mono mt-1">
                        <thead>
                            <tr className="text-slate-500 border-b border-slate-800">
                                <th className="text-left py-1.5 px-2 w-16">Offset</th>
                                <th className="text-left py-1.5 px-2">Type</th>
                                <th className="text-left py-1.5 px-2">Name</th>
                            </tr>
                        </thead>
                        <tbody>
                            {detail.properties.map((prop, i) => (
                                <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                                    <td className="py-1 px-2 text-orange-400">0x{prop.offset}</td>
                                    <td className="py-1 px-2">
                                        <span className="text-cyan-400">{prop.property_type}</span>
                                        {prop.sub_type && (
                                            <>
                                                <span className="text-slate-600 mx-1">&lt;</span>
                                                {prop.sub_type_address > 0 ? (
                                                    <button
                                                        onClick={() => onNavigate(prop.sub_type_address)}
                                                        className="text-yellow-400 hover:text-yellow-300 hover:underline cursor-pointer"
                                                    >
                                                        {prop.sub_type}
                                                    </button>
                                                ) : (
                                                    <span className="text-yellow-400">{prop.sub_type}</span>
                                                )}
                                                <span className="text-slate-600 ml-1">&gt;</span>
                                            </>
                                        )}
                                    </td>
                                    <td className="py-1 px-2 text-white">{prop.property_name}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* ─── Enum: Values List ─── */}
            {isEnum && (
                <div>
                    <SectionHeader title={`Enum Values (${detail.enum_values.length})`} />
                    {detail.enum_underlying_type && (
                        <div className="text-xs text-slate-500 mt-1 mb-2">Underlying Type: <span className="text-cyan-400">{detail.enum_underlying_type}</span></div>
                    )}
                    <table className="w-full text-xs font-mono mt-1">
                        <thead>
                            <tr className="text-slate-500 border-b border-slate-800">
                                <th className="text-left py-1.5 px-2">#</th>
                                <th className="text-left py-1.5 px-2">Name</th>
                                <th className="text-left py-1.5 px-2 w-24">Value</th>
                            </tr>
                        </thead>
                        <tbody>
                            {detail.enum_values.map((ev, i) => (
                                <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                                    <td className="py-1 px-2 text-slate-600">{i}</td>
                                    <td className="py-1 px-2 text-white">{ev.name}</td>
                                    <td className="py-1 px-2 text-amber-400">{ev.value}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* ─── Function: Signature ─── */}
            {isFunction && (
                <div>
                    <SectionHeader title="Function Signature" />
                    {detail.function_owner && (
                        <div className="text-xs mt-1">
                            <span className="text-slate-500">Owner: </span>
                            <button
                                onClick={() => onNavigate(detail.function_owner_address)}
                                className="text-blue-400 hover:text-blue-300 hover:underline"
                            >
                                {detail.function_owner}
                            </button>
                        </div>
                    )}
                    <div className="font-mono text-xs mt-2 bg-slate-800/40 rounded-md p-3 border border-slate-700/50">
                        <span className="text-cyan-400">{detail.function_return_type || 'void'}</span>
                        {' '}
                        <span className="text-emerald-400 font-bold">{detail.name}</span>
                        <span className="text-slate-400">(</span>
                        {detail.function_params.map((p, i) => (
                            <span key={i}>
                                {i > 0 && <span className="text-slate-400">, </span>}
                                <span className="text-cyan-400">{p.param_type}</span>
                                {' '}
                                <span className="text-white">{p.param_name}</span>
                            </span>
                        ))}
                        <span className="text-slate-400">)</span>
                    </div>
                    {detail.function_params.length > 0 && (
                        <table className="w-full text-xs font-mono mt-3">
                            <thead>
                                <tr className="text-slate-500 border-b border-slate-800">
                                    <th className="text-left py-1.5 px-2 w-40">Type</th>
                                    <th className="text-left py-1.5 px-2">Name</th>
                                    <th className="text-left py-1.5 px-2 w-20">Ref</th>
                                </tr>
                            </thead>
                            <tbody>
                                {detail.function_params.map((p, i) => (
                                    <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                                        <td className="py-1 px-2 text-cyan-400">{p.param_type}</td>
                                        <td className="py-1 px-2 text-white">{p.param_name}</td>
                                        <td className="py-1 px-2">
                                            {p.type_address > 0 ? (
                                                <button
                                                    onClick={() => onNavigate(p.type_address)}
                                                    className="text-blue-400 hover:text-blue-300 text-[10px]"
                                                >
                                                    →
                                                </button>
                                            ) : null}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
        </div>
    );
}

// ═══ Helper Components ═══

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
    return (
        <div className="flex">
            <span className="w-20 font-bold text-slate-500 shrink-0">{label}:</span>
            <span className={className || 'text-white'}>{value}</span>
        </div>
    );
}

function SectionHeader({ title }: { title: string }) {
    return (
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-700/60 pb-1">
            {title}
        </div>
    );
}
