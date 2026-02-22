import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Search, Box, Type, List, Variable, X, ArrowRight, Activity, Code, ChevronRight, Hash, Shield, Database, Globe, Loader2, Terminal } from 'lucide-react';
import { ObjectAnalyzerPanel } from './ObjectAnalyzerPanel';

interface PackageInfo { name: string; object_count: number; }
interface ObjectSummary { address: number; name: string; full_name: string; type_name: string; }
interface InheritanceItem { name: string; address: number; }
interface ObjectPropertyInfo { property_name: string; property_type: string; offset: string; sub_type: string; sub_type_address: number; }
interface EnumValueItem { name: string; value: number; }
interface FunctionParamInfo { param_type: string; param_name: string; type_address: number; }
interface GlobalSearchResult {
    package_name: string;
    object_name: string;
    type_name: string;
    address: number;
    member_name: string | null;
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

interface InspectorTab {
    address: number;
    name: string;
    type_name: string;
    detail: DetailedObjectInfo | null;
    loading: boolean;
}

// Global styles for custom scrollbar and animations
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
  @keyframes slideInRight {
    from { opacity: 0; transform: translateX(10px); }
    to { opacity: 1; transform: translateX(0); }
  }
  .animate-slide-in {
    animation: slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  .scrollbar-sci-fi::-webkit-scrollbar {
    width: 6px; height: 6px;
  }
  .scrollbar-sci-fi::-webkit-scrollbar-track {
    background: rgba(15, 23, 42, 0.6);
  }
  .scrollbar-sci-fi::-webkit-scrollbar-thumb {
    background: rgba(56, 189, 248, 0.3);
    border-radius: 4px;
  }
  .scrollbar-sci-fi::-webkit-scrollbar-thumb:hover {
    background: rgba(56, 189, 248, 0.6);
  }
`;

export function PackageViewer() {
    const [packages, setPackages] = useState<PackageInfo[]>([]);
    const [packageSearch, setPackageSearch] = useState("");
    const [selectedPackage, setSelectedPackage] = useState<string | null>(null);

    const [objects, setObjects] = useState<ObjectSummary[]>([]);
    const [objectSearch, setObjectSearch] = useState("");
    const [selectedCategory, setSelectedCategory] = useState<"Class" | "Struct" | "Enum" | "Function">("Class");

    const [tabs, setTabs] = useState<InspectorTab[]>([]);
    const [activeTabIndex, setActiveTabIndex] = useState<number>(-1);

    const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
    const [globalSearchQuery, setGlobalSearchQuery] = useState("");
    const [globalSearchMode, setGlobalSearchMode] = useState<"Object" | "Member">("Object");
    const [globalSearchResults, setGlobalSearchResults] = useState<GlobalSearchResult[]>([]);
    const [isGlobalSearching, setIsGlobalSearching] = useState(false);

    const [isAnalyzerOpen, setIsAnalyzerOpen] = useState(false);

    const activeTabRef = useRef<HTMLDivElement>(null);
    const tabBarRef = useRef<HTMLDivElement>(null);
    const packageListRef = useRef<HTMLDivElement>(null);
    const objectListRef = useRef<HTMLDivElement>(null);

    // Auto-scroll sync state
    const [pendingScrollObjRef, setPendingScrollObjRef] = useState<number | null>(null);

    useEffect(() => {
        if (activeTabRef.current && tabBarRef.current) {
            const tab = activeTabRef.current;
            const container = tabBarRef.current;
            const scrollOffset = tab.offsetLeft - (container.clientWidth / 2) + (tab.clientWidth / 2);
            container.scrollTo({ left: scrollOffset, behavior: 'smooth' });
        }
    }, [activeTabIndex, tabs.length]);

    const filteredPackages = useMemo(() => {
        if (!packageSearch) return packages;
        const s = packageSearch.toLowerCase();
        return packages.filter(p => p.name.toLowerCase().includes(s));
    }, [packageSearch, packages]);

    const filteredObjects = useMemo(() => {
        if (!objectSearch) return objects;
        const s = objectSearch.toLowerCase();
        return objects.filter(o => o.name.toLowerCase().includes(s));
    }, [objectSearch, objects]);

    // Handle reliable object scrolling after objects are loaded
    useEffect(() => {
        if (pendingScrollObjRef !== null && objects.length > 0) {
            const exists = objects.some(o => o.address === pendingScrollObjRef);
            if (exists) {
                requestAnimationFrame(() => {
                    setTimeout(() => {
                        if (objectListRef.current) {
                            const activeObj = objectListRef.current.querySelector(`[data-obj="${pendingScrollObjRef}"]`);
                            if (activeObj) {
                                activeObj.scrollIntoView({ behavior: 'auto', block: 'nearest' });
                            }
                        }
                        setPendingScrollObjRef(null);
                    }, 50);
                });
            } else {
                // If it doesn't exist in the current objects array, we might still be loading
                // We'll let the next objects update trigger this again.
            }
        }
    }, [objects, pendingScrollObjRef]);

    const activeTab = activeTabIndex >= 0 && activeTabIndex < tabs.length ? tabs[activeTabIndex] : null;

    useEffect(() => {
        if (!globalSearchQuery || globalSearchQuery.length < 2) {
            setGlobalSearchResults([]);
            return;
        }

        const delayDebounceFn = setTimeout(async () => {
            setIsGlobalSearching(true);
            try {
                const results = await invoke<GlobalSearchResult[]>('global_search', { query: globalSearchQuery, searchMode: globalSearchMode });
                setGlobalSearchResults(results);
            } catch (err) {
                console.error("Global search failed:", err);
            } finally {
                setIsGlobalSearching(false);
            }
        }, 500);

        return () => clearTimeout(delayDebounceFn);
    }, [globalSearchQuery, globalSearchMode]);

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

        try {
            const detail = await invoke<DetailedObjectInfo>('get_object_details', { address: obj.address });
            setTabs(prev => prev.map(t => t.address === obj.address ? { ...t, detail, loading: false } : t));
        } catch (err) {
            console.error("Failed to fetch object details:", err);
            setTabs(prev => prev.map(t => t.address === obj.address ? { ...t, loading: false } : t));
        }
    };

    const handleNavigateToObject = async (address: number) => {
        if (!address || address === 0) return;
        const existingIndex = tabs.findIndex(t => t.address === address);
        if (existingIndex >= 0) {
            setActiveTabIndex(existingIndex);
            return;
        }

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

    const handleGlobalSearchResultClick = useCallback((result: GlobalSearchResult) => {
        const pkgName = result.package_name;
        setSelectedPackage(pkgName);
        let cat: "Class" | "Struct" | "Enum" | "Function" = "Class";
        const t = result.type_name.toLowerCase();
        if (t.includes('struct') && !t.includes('class')) {
            cat = "Struct";
        } else if (t.includes('enum') || t === 'userenum') {
            cat = "Enum";
        } else if (t.includes('function') || t.includes('delegate')) {
            cat = "Function";
        } else {
            cat = "Class"; // Default to class and specifically handle class types
        }
        setSelectedCategory(cat);
        setObjectSearch(''); // Clear filter to ensure object isn't hidden
        handleNavigateToObject(result.address);
        setPendingScrollObjRef(result.address); // Queue object scroll for after objects load

        // Auto-scroll logic for packages
        requestAnimationFrame(() => {
            setTimeout(() => {
                if (packageListRef.current) {
                    const activePkg = packageListRef.current.querySelector(`[data-pkg="${pkgName}"]`);
                    if (activePkg) {
                        activePkg.scrollIntoView({ behavior: 'auto', block: 'nearest' });
                    }
                }
            }, 50);
        });
    }, [handleNavigateToObject]);

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

    const loadPackages = useCallback(() => {
        invoke<PackageInfo[]>('get_packages').then(pkgs => {
            if (pkgs.length > 0) setPackages(pkgs);
        }).catch(err => console.error("Failed to load packages", err));
    }, []);

    useEffect(() => {
        loadPackages();
        const win = getCurrentWindow();
        let unlisten: (() => void) | null = null;
        win.onFocusChanged(({ payload: focused }) => {
            if (focused) loadPackages();
        }).then(fn => { unlisten = fn; });
        return () => { if (unlisten) unlisten(); };
    }, [loadPackages]);

    useEffect(() => {
        if (selectedPackage) {
            invoke<ObjectSummary[]>('get_objects', { packageName: selectedPackage, category: selectedCategory })
                .then(objs => setObjects(objs))
                .catch(err => console.error("Failed to load objects", err));
        } else {
            setObjects([]);
        }
    }, [selectedPackage, selectedCategory]);

    // Categories
    const categories = [
        { id: 'Class', icon: Box, color: 'text-cyan-400', bg: 'bg-cyan-400/10' },
        { id: 'Struct', icon: List, color: 'text-cyan-400', bg: 'bg-cyan-400/10' },
        { id: 'Enum', icon: Type, color: 'text-cyan-400', bg: 'bg-cyan-400/10' },
        { id: 'Function', icon: Variable, color: 'text-cyan-400', bg: 'bg-cyan-400/10' }
    ] as const;

    return (
        <div className="flex w-full h-full text-slate-300 overflow-hidden bg-[#0a0f18] relative font-sans">
            <style dangerouslySetInnerHTML={{ __html: globalStyles }} />

            {/* Ambient Background Glows */}
            <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-cyan-900/20 blur-[120px] pointer-events-none" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-900/10 blur-[100px] pointer-events-none" />

            {/* Scanline overlay */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-10 mix-blend-overlay z-50">
                <div className="w-full h-[2px] bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.8)] animate-[scanline_4s_linear_infinite]" />
            </div>

            {/* ───── Sidebar Tools ───── */}
            <div className="w-12 bg-slate-[950] border-r border-slate-800/80 flex flex-col items-center py-4 z-40 shrink-0 shadow-[4px_0_15px_rgba(0,0,0,0.3)] gap-3 relative">

                {/* 1. Object Analyzer Tool */}
                <button
                    onClick={() => {
                        setIsAnalyzerOpen(!isAnalyzerOpen);
                        if (!isAnalyzerOpen) setIsGlobalSearchOpen(false);
                    }}
                    className={`p-2.5 rounded-lg transition-all relative group ${isAnalyzerOpen ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 shadow-[0_0_15px_rgba(34,211,238,0.2)]' : 'text-slate-500 hover:text-cyan-400 hover:bg-slate-800'}`}
                    title="Object Analyzer"
                >
                    {isAnalyzerOpen && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-1/2 bg-cyan-400 rounded-r-md shadow-[0_0_8px_rgba(34,211,238,0.8)]" />}
                    <Terminal className={`w-5 h-5 transition-transform ${isAnalyzerOpen ? 'animate-[pulseGlow_3s_ease-in-out_infinite]' : 'group-hover:scale-110'}`} />
                </button>

                {/* 2. Global Search Tool */}
                <button
                    onClick={() => {
                        setIsGlobalSearchOpen(!isGlobalSearchOpen);
                        if (!isGlobalSearchOpen) setIsAnalyzerOpen(false);
                    }}
                    className={`p-2.5 rounded-lg transition-all relative group ${isGlobalSearchOpen ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 shadow-[0_0_15px_rgba(34,211,238,0.2)]' : 'text-slate-500 hover:text-cyan-400 hover:bg-slate-800'}`}
                    title="Global Search"
                >
                    {isGlobalSearchOpen && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-1/2 bg-cyan-400 rounded-r-md shadow-[0_0_8px_rgba(34,211,238,0.8)]" />}
                    <Globe className={`w-5 h-5 transition-transform ${isGlobalSearchOpen ? 'animate-[pulseGlow_3s_ease-in-out_infinite]' : 'group-hover:scale-110'}`} />
                </button>
            </div>

            {/* ───── Column 0: Analyzer Panel ───── */}
            <ObjectAnalyzerPanel isOpen={isAnalyzerOpen} onClose={() => setIsAnalyzerOpen(false)} />

            {/* ───── Column 0.5: Global Search Sidebar ───── */}
            <div className={`flex flex-col bg-[#0f172a]/95 backdrop-blur-xl relative z-20 shrink-0 transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)] overflow-hidden border-r border-slate-800/80 shadow-[10px_0_30px_rgba(0,0,0,0.5)] ${isGlobalSearchOpen ? 'w-[320px]' : 'w-0 border-r-0 shadow-none opacity-0'}`}>
                <div className="p-4 border-b border-slate-800/80 shrink-0 w-[320px]">
                    <div className="flex items-center gap-2 mb-4">
                        <Globe className="w-4 h-4 text-cyan-400" />
                        <span className="text-xs font-black uppercase tracking-[0.2em] text-slate-200 flex-1">Global Search</span>
                        <button onClick={() => setIsGlobalSearchOpen(false)} className="text-slate-500 hover:text-rose-400 transition-colors p-1 rounded-md hover:bg-rose-500/10">
                            <X className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="flex bg-slate-900/80 rounded-lg p-1 border border-slate-700/50 mb-4 shadow-inner">
                        <button
                            onClick={() => setGlobalSearchMode("Object")}
                            className={`flex-1 text-[10px] uppercase tracking-widest py-1.5 rounded-md transition-all font-bold ${globalSearchMode === 'Object' ? 'bg-cyan-500/20 text-cyan-300 shadow-sm border border-cyan-500/20' : 'text-slate-500 hover:text-slate-300'}`}
                        >
                            Object
                        </button>
                        <button
                            onClick={() => setGlobalSearchMode("Member")}
                            className={`flex-1 text-[10px] uppercase tracking-widest py-1.5 rounded-md transition-all font-bold ${globalSearchMode === 'Member' ? 'bg-cyan-500/20 text-cyan-300 shadow-sm border border-cyan-500/20' : 'text-slate-500 hover:text-slate-300'}`}
                        >
                            Member
                        </button>
                    </div>

                    <div className="relative group">
                        <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${globalSearchQuery ? 'text-cyan-400' : 'text-slate-500 group-focus-within:text-cyan-400'}`} />
                        <input
                            type="text"
                            placeholder={globalSearchMode === "Object" ? "SEARCH OBJECTS..." : "SEARCH MEMBERS..."}
                            value={globalSearchQuery}
                            onChange={e => setGlobalSearchQuery(e.target.value)}
                            className="w-full bg-slate-900/60 border border-slate-700/50 rounded-lg text-[11px] py-2 pl-9 pr-3 outline-none focus:border-cyan-500/50 focus:bg-slate-900/90 focus:shadow-[0_0_15px_rgba(34,211,238,0.1)] transition-all text-slate-100 placeholder:text-slate-600 font-mono tracking-wide"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1.5 scrollbar-sci-fi w-[320px]">
                    {isGlobalSearching ? (
                        <div className="flex flex-col items-center justify-center h-48 text-cyan-500/50 gap-4">
                            <Loader2 className="w-8 h-8 animate-spin opacity-80" />
                            <span className="text-[10px] font-mono tracking-widest font-bold">SCANNING MEMORY...</span>
                        </div>
                    ) : globalSearchResults.length > 0 ? (
                        globalSearchResults.map((res, i) => (
                            <button
                                key={i}
                                onClick={() => handleGlobalSearchResultClick(res)}
                                className="w-full text-left px-3 py-2.5 text-[11px] rounded-lg transition-all bg-slate-900/30 hover:bg-slate-800/90 border border-transparent group flex flex-col gap-1.5"
                            >
                                <div className="flex items-center gap-2">
                                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-200 shrink-0 select-none">
                                        {res.type_name}
                                    </span>
                                    <span className="font-semibold text-slate-100 truncate">
                                        {res.member_name ? res.member_name : res.object_name}
                                    </span>
                                </div>
                            </button>
                        ))
                    ) : globalSearchQuery.length >= 2 ? (
                        <div className="flex flex-col items-center justify-center h-48 text-slate-600 gap-3">
                            <Search className="w-8 h-8 opacity-20" />
                            <div className="text-[10px] uppercase font-mono tracking-widest font-bold">NO MATCHES FOUND</div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-48 text-slate-600 gap-3 px-6 text-center">
                            <Database className="w-8 h-8 opacity-20 mb-1" />
                            <div className="text-[10px] uppercase font-mono tracking-wider leading-relaxed">
                                INITIALIZE QUERY<br /><span className="opacity-50 text-[9px]">MINIMUM 2 CHARACTERS</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* ───── Column 1: Packages ───── */}
            <div className="w-[280px] flex flex-col border-r border-slate-800/80 bg-slate-950/40 backdrop-blur-md relative z-10 shrink-0">
                <div className="relative p-4 border-b border-slate-800/80">
                    <div className="flex items-center gap-2 mb-3">
                        <Box className="w-4 h-4 text-cyan-400" />
                        <span className="text-xs font-black uppercase tracking-[0.2em] text-slate-300">Packages</span>
                        <span className="ml-auto text-[10px] font-mono text-cyan-500/70 bg-cyan-500/10 px-2 rounded-full border border-cyan-500/20">
                            {filteredPackages.length}
                        </span>
                    </div>
                    <div className="relative group">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-cyan-400 transition-colors" />
                        <input
                            type="text"
                            placeholder="SEARCH PACKAGES..."
                            value={packageSearch}
                            onChange={e => setPackageSearch(e.target.value)}
                            className="w-full bg-slate-900/50 border border-slate-700/50 rounded-lg text-xs py-2 pl-9 pr-3 outline-none focus:border-cyan-500/50 focus:bg-slate-900/80 transition-all text-slate-200 placeholder:text-slate-600 font-mono tracking-wide shadow-inner"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-sci-fi" ref={packageListRef}>
                    {filteredPackages.map(pkg => {
                        const isSelected = selectedPackage === pkg.name;
                        return (
                            <button
                                key={pkg.name}
                                data-pkg={pkg.name}
                                onClick={() => setSelectedPackage(pkg.name)}
                                className={`w-full text-left px-3 py-2 text-[12px] rounded-lg transition-all flex justify-between items-center group
                                    ${isSelected
                                        ? 'bg-gradient-to-r from-cyan-600/20 to-transparent border border-cyan-500/30 text-cyan-50'
                                        : 'hover:bg-slate-800/40 border border-transparent text-slate-400 hover:text-slate-200'}`}
                            >
                                <span className={`truncate transition-colors ${isSelected ? 'font-semibold text-cyan-300' : ''}`}>
                                    {pkg.name.replace('/Script/', '')}
                                </span>
                                <div className="flex items-center gap-2 shrink-0">
                                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${isSelected ? 'bg-cyan-500/20 text-cyan-200' : 'bg-slate-800/60 text-slate-500 group-hover:bg-slate-700/50'}`}>
                                        {pkg.object_count}
                                    </span>
                                    {isSelected && <ChevronRight className="w-3.5 h-3.5 text-cyan-400" />}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* ───── Column 2: Objects ───── */}
            <div className="w-[300px] flex flex-col border-r border-slate-800/80 bg-slate-900/30 backdrop-blur-sm relative z-10 shrink-0">
                <div className="p-3 border-b border-slate-800/80 grid grid-cols-4 gap-1.5">
                    {categories.map(cat => {
                        const isSelected = selectedCategory === cat.id;
                        return (
                            <button
                                key={cat.id}
                                onClick={() => setSelectedCategory(cat.id as any)}
                                title={cat.id}
                                className={`flex flex-col items-center gap-1.5 py-2.5 rounded-lg transition-all relative overflow-hidden group
                                    ${isSelected
                                        ? 'bg-slate-800/80 border border-slate-700 shadow-[0_0_15px_rgba(0,0,0,0.5)]'
                                        : 'hover:bg-slate-800/40 border border-transparent'}`}
                            >
                                <cat.icon className={`w-4 h-4 ${isSelected ? cat.color : 'text-slate-500 group-hover:text-slate-400'}`} />
                                <span className={`text-[9px] font-bold uppercase tracking-widest ${isSelected ? 'text-white' : 'text-slate-500'}`}>
                                    {cat.id}
                                </span>
                            </button>
                        );
                    })}
                </div>

                <div className="p-3 border-b border-slate-800/80 bg-slate-900/40">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
                            {(() => {
                                const Icon = categories.find(c => c.id === selectedCategory)?.icon;
                                return Icon ? <Icon className="w-3 h-3" /> : null;
                            })()}
                            {selectedCategory}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">{filteredObjects.length} FOUND</span>
                    </div>
                    <div className="relative group">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 group-focus-within:text-slate-300 transition-colors" />
                        <input
                            type="text"
                            placeholder="Filter objects..."
                            value={objectSearch}
                            onChange={e => setObjectSearch(e.target.value)}
                            className="w-full bg-slate-950/50 border border-slate-800 rounded text-[11px] py-1.5 pl-8 pr-3 outline-none focus:border-slate-600 transition-all text-slate-200 placeholder:text-slate-600"
                        />
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-0.5 scrollbar-sci-fi" ref={objectListRef}>
                    {filteredObjects.length === 0 && selectedPackage ? (
                        <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-2 opacity-50">
                            <Hash className="w-8 h-8" />
                            <span className="text-xs font-mono uppercase tracking-widest">No Items</span>
                        </div>
                    ) : null}
                    {filteredObjects.map(obj => {
                        const isActive = activeTab?.address === obj.address;
                        return (
                            <button
                                key={obj.address}
                                data-obj={obj.address}
                                onClick={() => handleObjectClick(obj)}
                                className={`w-full text-left px-2.5 py-2 text-[12px] rounded border transition-all flex items-center gap-2 group
                                    ${isActive
                                        ? 'bg-slate-800/80 border-slate-600 shadow-md text-white'
                                        : 'border-transparent hover:bg-slate-800/40 hover:border-slate-700/50 text-slate-400'}`}
                            >
                                <span className={`w-1.5 h-1.5 rounded-full transition-colors shrink-0 ${isActive ? 'bg-cyan-400 shadow-[0_0_5px_rgba(34,211,238,0.8)]' : 'bg-slate-700 group-hover:bg-slate-500'}`} />
                                <div className="truncate font-mono" title={obj.full_name}>
                                    {obj.name}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* ───── Column 3: Inspector ───── */}
            <div className="flex-1 overflow-hidden flex flex-col bg-slate-950 relative z-10 shadow-[inner_20px_0_40px_rgba(0,0,0,0.5)] border-l border-slate-900 min-w-0">
                {tabs.length > 0 ? (
                    <>
                        {/* Tab bar */}
                        <div ref={tabBarRef} className="flex items-end gap-1 px-3 pt-3 border-b border-slate-800/80 bg-slate-900/60 overflow-x-auto scrollbar-sci-fi shrink-0 shadow-sm relative z-20">
                            {tabs.map((tab, idx) => {
                                const isActive = activeTabIndex === idx;
                                return (
                                    <div
                                        key={`${tab.address}-${idx}`}
                                        ref={isActive ? activeTabRef : null}
                                        className="relative group/tab flex items-center"
                                    >
                                        <button
                                            onClick={() => setActiveTabIndex(idx)}
                                            onMouseDown={(e) => {
                                                if (e.button === 1) {
                                                    e.preventDefault();
                                                    handleCloseTab(idx, e);
                                                }
                                            }}
                                            className={`flex items-center gap-2 px-4 py-2 text-[11px] font-mono rounded-t-lg border-t border-x transition-all max-w-[200px] min-w-[120px] shrink-0 overflow-hidden relative
                                                ${isActive
                                                    ? 'bg-slate-950 text-cyan-300 border-cyan-900/50 shadow-[0_-4px_15px_rgba(8,145,178,0.1)] z-10'
                                                    : 'bg-slate-900/50 text-slate-500 border-slate-800/50 hover:bg-slate-800 hover:text-slate-300'}`}
                                        >
                                            {isActive && <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-cyan-600 to-emerald-500" />}
                                            <span className="truncate flex-1 font-semibold">{tab.name}</span>
                                            {tab.loading && <Activity className="w-3 h-3 animate-pulse text-cyan-500 shrink-0" />}
                                        </button>
                                        <button
                                            onClick={(e) => handleCloseTab(idx, e)}
                                            className={`absolute right-1.5 top-1/2 -translate-y-1/2 w-4 h-4 rounded-sm flex items-center justify-center transition-all z-20
                                                ${isActive ? 'opacity-100 text-slate-500 hover:bg-rose-500/20 hover:text-rose-400' : 'opacity-0 group-hover/tab:opacity-100 text-slate-600 hover:bg-slate-700 hover:text-slate-300'}`}
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Detail content */}
                        <div className="flex-1 overflow-y-auto scrollbar-sci-fi relative bg-[#0a0f18]/80 backdrop-blur">
                            {tabs.map((tab, idx) => {
                                const isActive = activeTabIndex === idx;
                                return (
                                    <div key={`${tab.address}-${idx}`} className={`h-full ${isActive ? 'block' : 'hidden'}`}>
                                        {tab.loading ? (
                                            <div className="flex flex-col items-center justify-center h-full text-cyan-500/50 gap-4">
                                                <div className="relative w-16 h-16">
                                                    <div className="absolute inset-0 rounded-full border-t-2 border-cyan-500 animate-spin" />
                                                    <div className="absolute inset-2 rounded-full border-r-2 border-emerald-500 animate-[spin_1.5s_reverse_infinite]" />
                                                    <div className="absolute inset-4 rounded-full border-b-2 border-amber-500 animate-spin" />
                                                    <Activity className="absolute inset-0 m-auto w-6 h-6 animate-pulse" />
                                                </div>
                                                <span className="text-[10px] font-mono tracking-[0.3em] font-bold">DECRYPTING MEMORY...</span>
                                            </div>
                                        ) : tab.detail ? (
                                            <div className="p-6 max-w-5xl mx-auto animate-slide-in">
                                                <DetailView
                                                    detail={tab.detail}
                                                    onNavigate={handleNavigateToObject}
                                                />
                                            </div>
                                        ) : (
                                            <div className="flex flex-col items-center justify-center h-full text-rose-500/50 gap-3">
                                                <Shield className="w-12 h-12 stroke-[1.5]" />
                                                <span className="text-xs font-mono tracking-widest font-bold">ACCESS DENIED / DATA CORRUPT</span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-700 gap-4 relative">
                        <div className="w-32 h-32 rounded-full border border-slate-800 flex items-center justify-center bg-slate-900/30 relative">
                            <div className="absolute inset-0 rounded-full border border-slate-700/30 animate-[ping_3s_infinite]" />
                            <Search className="w-10 h-10 opacity-30" />
                        </div>
                        <span className="text-xs font-mono uppercase tracking-[0.2em] opacity-40">Awaiting Target Selection</span>
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
        <div className="flex flex-col gap-8 text-slate-300">
            {/* ─── Header Card ─── */}
            <div className="bg-slate-900/60 rounded-xl border border-slate-800/80 p-5 shadow-lg relative overflow-hidden group">
                {/* Decorative background lines */}
                <div className="absolute -top-10 -right-10 w-40 h-40 bg-blue-500/5 rounded-full blur-3xl" />
                <div className="absolute right-0 top-0 bottom-0 w-[1px] bg-gradient-to-b from-transparent via-cyan-500/20 to-transparent" />

                <div className="flex gap-x-6 gap-y-4 relative z-10 justify-between items-start">
                    <div className="flex flex-col gap-2 flex-1 min-w-0 pr-4">
                        <div className="flex items-center gap-3">
                            <span className="text-2xl font-mono font-bold text-slate-100 truncate" title={detail.name}>
                                {detail.name}
                            </span>
                            <span className="px-2 py-0.5 text-[10px] bg-slate-800 text-cyan-400 rounded-full border border-cyan-900/50 shrink-0">
                                {detail.type_name}
                            </span>
                        </div>
                        <span className="text-[11px] font-mono text-slate-500 truncate" title={detail.full_name}>
                            {detail.full_name}
                        </span>
                    </div>

                    <div className="flex flex-col gap-3 shrink-0 bg-slate-950/40 p-3 rounded-lg border border-slate-800/50">
                        <div className="flex justify-between items-center text-xs font-mono gap-4">
                            <span className="text-slate-500 uppercase tracking-wider text-[10px]">Memory Address</span>
                            <button
                                className="text-amber-400 font-bold bg-amber-400/10 px-2 py-0.5 rounded shadow-[0_0_10px_rgba(251,191,36,0.1)] hover:text-amber-300 hover:bg-amber-400/20 transition-colors cursor-pointer"
                                onClick={() => navigator.clipboard.writeText(`0x${detail.address.toString(16).toUpperCase()}`)}
                                title={`Copy: 0x${detail.address.toString(16).toUpperCase()}`}
                            >
                                0x{detail.address.toString(16).toUpperCase()}
                            </button>
                        </div>
                        {isFunction && detail.function_offset && (
                            <div className="flex justify-between items-center text-xs font-mono gap-4">
                                <span className="text-slate-500 uppercase tracking-wider text-[10px]">Exec Offset</span>
                                <span className="text-rose-400 font-bold">
                                    {detail.function_offset}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ─── Inheritance Chain ─── */}
            {detail.inheritance.length > 0 && (
                <div className="flex flex-col gap-3">
                    <SectionHeader title="Inheritance Sequence" icon={<Activity className="w-4 h-4 text-cyan-500" />} />
                    <div className="flex flex-wrap items-center gap-2 font-mono text-xs bg-slate-900/40 p-4 rounded-lg border border-slate-800/60 shadow-inner">
                        {detail.inheritance.map((item, i) => (
                            <div key={i} className="flex items-center gap-2">
                                <button
                                    onClick={() => onNavigate(item.address)}
                                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-cyan-900/40 text-slate-400 hover:text-cyan-300 border border-slate-700 hover:border-cyan-700/50 transition-all flex items-center gap-1.5 shadow-sm"
                                >
                                    <Box className="w-3 h-3 opacity-60" />
                                    {item.name}
                                </button>
                                <ArrowRight className="w-3 h-3 text-slate-600" />
                            </div>
                        ))}
                        <div className="px-2.5 py-1 rounded bg-cyan-900/20 text-cyan-300 border border-cyan-800/50 flex items-center gap-1.5 font-bold shadow-[0_0_10px_rgba(34,211,238,0.1)]">
                            <Box className="w-3 h-3 text-cyan-400" />
                            {detail.name}
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Class/Struct Properties Table ─── */}
            {isClass && detail.properties.length > 0 && (
                <div className="flex flex-col gap-3">
                    <SectionHeader
                        title="Memory Layout"
                        count={detail.properties.length}
                        icon={<Database className="w-4 h-4 text-emerald-500" />}
                    />
                    <div className="bg-slate-900/50 rounded-lg border border-slate-800/80 overflow-hidden shadow-lg backdrop-blur text-[13px] font-mono">
                        <table className="w-full text-left">
                            <thead className="bg-slate-950/80 text-[10px] uppercase tracking-widest text-slate-500">
                                <tr>
                                    <th className="py-3 px-4 w-28 font-semibold border-b border-slate-800">Offset</th>
                                    <th className="py-3 px-4 font-semibold border-b border-slate-800">Type Definition</th>
                                    <th className="py-3 px-4 font-semibold border-b border-slate-800">Property Name</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/60">
                                {detail.properties.map((prop, i) => {
                                    const isPointer = prop.property_type.includes("ObjectProperty");
                                    return (
                                        <tr key={i} className="hover:bg-slate-800/40 transition-colors group">
                                            <td className="py-2.5 px-4 text-slate-400 group-hover:text-amber-400 transition-colors">
                                                0x{prop.offset}
                                            </td>
                                            <td className="py-2.5 px-4 flex items-center flex-wrap gap-1">
                                                <span className={`px-1.5 py-0.5 rounded text-[11px] ${isPointer ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' : 'text-emerald-400'}`}>
                                                    {prop.property_type}
                                                </span>
                                                {prop.sub_type && (
                                                    <div className="flex items-center gap-1 text-slate-500 ml-1">
                                                        <span>&lt;</span>
                                                        {prop.sub_type_address > 0 ? (
                                                            <button
                                                                onClick={() => onNavigate(prop.sub_type_address)}
                                                                className="text-cyan-400 hover:text-cyan-300 hover:underline hover:bg-cyan-400/10 px-1 rounded transition-colors"
                                                            >
                                                                {prop.sub_type}
                                                            </button>
                                                        ) : (
                                                            <span className="text-slate-300">{prop.sub_type}</span>
                                                        )}
                                                        <span>&gt;</span>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="py-2.5 px-4 text-slate-200 font-semibold group-hover:text-white transition-colors">
                                                {prop.property_name}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ─── Enum Values Table ─── */}
            {isEnum && (
                <div className="flex flex-col gap-3">
                    <SectionHeader
                        title="Enumerated Values"
                        count={detail.enum_values.length}
                        icon={<List className="w-4 h-4 text-purple-500" />}
                    />

                    {detail.enum_underlying_type && (
                        <div className="text-xs font-mono bg-slate-900/40 border border-slate-800/60 p-3 rounded-lg flex items-center gap-3">
                            <span className="text-slate-500 uppercase tracking-widest text-[10px]">Underlying Type</span>
                            <span className="text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20">{detail.enum_underlying_type}</span>
                        </div>
                    )}

                    <div className="bg-slate-900/50 rounded-lg border border-slate-800/80 overflow-hidden shadow-lg backdrop-blur text-[13px] font-mono mt-2">
                        <table className="w-full text-left">
                            <thead className="bg-slate-950/80 text-[10px] uppercase tracking-widest text-slate-500">
                                <tr>
                                    <th className="py-3 px-4 w-16 font-semibold border-b border-slate-800 text-center">Idx</th>
                                    <th className="py-3 px-4 font-semibold border-b border-slate-800">Value Name</th>
                                    <th className="py-3 px-4 w-32 font-semibold border-b border-slate-800 text-right">Value (Dec)</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/60">
                                {detail.enum_values.map((ev, i) => (
                                    <tr key={i} className="hover:bg-slate-800/40 transition-colors group">
                                        <td className="py-2 px-4 text-slate-600 text-center text-xs">{i}</td>
                                        <td className="py-2 px-4 text-slate-200 group-hover:text-purple-300 transition-colors">
                                            {ev.name}
                                        </td>
                                        <td className="py-2 px-4 text-amber-500 text-right group-hover:text-amber-400 font-bold">
                                            {ev.value}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ─── Function Signature ─── */}
            {isFunction && (
                <div className="flex flex-col gap-5">
                    <SectionHeader
                        title="Execution Signature"
                        icon={<Code className="w-4 h-4 text-rose-500" />}
                    />

                    <div className="p-5 rounded-xl bg-slate-950/80 border border-slate-800 shadow-[inset_0_4px_20px_rgba(0,0,0,0.5)] font-mono text-[13px] relative overflow-hidden group">
                        {detail.function_owner && (
                            <div className="mb-4 flex items-center gap-2 text-xs border-b border-slate-800/50 pb-3">
                                <span className="text-slate-500 uppercase tracking-widest text-[10px]">Context Class</span>
                                <button
                                    onClick={() => onNavigate(detail.function_owner_address)}
                                    className="text-blue-400 hover:text-blue-300 py-0.5 px-2 bg-blue-500/10 rounded border border-blue-500/20 transition-colors flex items-center gap-1.5"
                                >
                                    <Box className="w-3 h-3" />
                                    {detail.function_owner}
                                </button>
                            </div>
                        )}

                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-2">
                            <span className="text-rose-400 font-semibold">{detail.function_return_type || 'void'}</span>
                            <span className="text-slate-100 font-bold text-sm tracking-wide">{detail.name}</span>
                            <span className="text-slate-500 text-lg leading-none">(</span>
                        </div>

                        <div className="flex flex-col gap-1 pl-6 py-2 border-l border-slate-800 ml-2">
                            {detail.function_params.length === 0 ? (
                                <span className="text-slate-600 italic">{'/* No parameters */'}</span>
                            ) : (
                                detail.function_params.map((p, i) => (
                                    <div key={i} className="flex flex-wrap items-center gap-2">
                                        {p.type_address > 0 ? (
                                            <button
                                                onClick={() => onNavigate(p.type_address)}
                                                className="text-cyan-400 hover:text-cyan-300 hover:underline hover:bg-cyan-500/10 px-1 rounded transition-colors"
                                                title={`Inspect ${p.param_type}`}
                                            >
                                                {p.param_type}
                                            </button>
                                        ) : (
                                            <span className="text-cyan-400">{p.param_type}</span>
                                        )}
                                        <span className="text-slate-300">{p.param_name}</span>
                                        {i < detail.function_params.length - 1 && <span className="text-slate-600">,</span>}
                                    </div>
                                ))
                            )}
                        </div>
                        <div className="text-slate-500 text-lg leading-none mt-1">)</div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ═══ Reusable Utility UI ═══

function SectionHeader({ title, count, icon }: { title: string, count?: number, icon?: React.ReactNode }) {
    return (
        <div className="flex items-center gap-2 border-b border-slate-800/80 pb-2 mb-2 relative">
            {icon && <div className="p-1.5 rounded-md bg-slate-900 border border-slate-800">{icon}</div>}
            <h3 className="text-[12px] font-bold uppercase tracking-[0.2em] text-slate-300">
                {title}
            </h3>
            {count !== undefined && (
                <span className="ml-auto text-[10px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded-full border border-slate-800">
                    {count}
                </span>
            )}
            <div className="absolute bottom-0 left-0 w-1/3 h-[1px] bg-gradient-to-r from-slate-600 to-transparent" />
        </div>
    );
}
