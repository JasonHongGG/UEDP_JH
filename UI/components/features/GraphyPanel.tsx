import React, { useState, useEffect, useRef, useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { Search, ZoomIn, ZoomOut, Maximize, Activity, Trash2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface NodeData {
    id: string; // Address as hex string
    name: string;
    type: string; // Class, Struct, Property, etc.
    val: number; // Node size
    color?: string;
}

interface LinkData {
    source: string;
    target: string;
    label: string;
    color?: string;
    type: 'Inheritance' | 'Member';
}

interface GraphData {
    nodes: NodeData[];
    links: LinkData[];
}

export function GraphyPanel() {
    const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
    const fgRef = useRef<any>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [hoverNode, setHoverNode] = useState<NodeData | null>(null);

    const expandNode = useCallback(async (addressStr: string) => {
        setIsLoading(true);
        try {
            const addr = parseInt(addressStr, 16);
            if (isNaN(addr) || addr === 0) throw new Error("Invalid address");

            const rootId = addr.toString(16);

            // Fetch everything concurrently
            const [detailsRes, inheritanceRes, memberRes] = await Promise.all([
                invoke('get_object_details', { address: addr }).catch(e => { console.warn(e); return null; }),
                invoke('search_object_references', { addressStr: addressStr, searchMode: "Inheritance" }).catch(e => { console.warn(e); return []; }),
                invoke('search_object_references', { addressStr: addressStr, searchMode: "Member" }).catch(e => { console.warn(e); return []; })
            ]);

            const toAddNodes: NodeData[] = [];
            const toAddLinks: LinkData[] = [];

            if (detailsRes) {
                const d = detailsRes as any;
                toAddNodes.push({ id: rootId, name: d.name, type: d.type_name, color: '#22d3ee', val: 12 }); // Expanded root

                let prevId = rootId;
                for (const inherit of d.inheritance) {
                    if (inherit.address > 0) {
                        const inheritId = inherit.address.toString(16);
                        toAddNodes.push({ id: inheritId, name: inherit.name, type: "Class/Struct", color: '#94a3b8', val: 8 });
                        toAddLinks.push({ source: prevId, target: inheritId, label: 'Inherits', type: 'Inheritance', color: 'rgba(34,211,238,0.5)' });
                        prevId = inheritId;
                    }
                }

                for (const prop of d.properties) {
                    if (prop.sub_type_address > 0) {
                        const propId = prop.sub_type_address.toString(16);
                        toAddNodes.push({ id: propId, name: prop.sub_type || prop.property_name, type: prop.property_type, color: '#fcd34d', val: 5 });
                        toAddLinks.push({ source: rootId, target: propId, label: prop.property_name, type: 'Member', color: 'rgba(251,191,36,0.3)' });
                    }
                }
            }

            if (inheritanceRes) {
                for (const ref of (inheritanceRes as any[])) {
                    if (ref.address > 0) {
                        const refId = ref.address.toString(16);
                        toAddNodes.push({ id: refId, name: ref.object_name, type: ref.type_name, color: '#cbd5e1', val: 7 });
                        toAddLinks.push({ source: refId, target: rootId, label: 'Inherits from', type: 'Inheritance', color: 'rgba(34,211,238,0.5)' });
                    }
                }
            }

            if (memberRes) {
                for (const ref of (memberRes as any[])) {
                    if (ref.address > 0) {
                        const refId = ref.address.toString(16);
                        toAddNodes.push({ id: refId, name: ref.object_name, type: ref.type_name, color: '#fde68a', val: 6 });
                        toAddLinks.push({ source: refId, target: rootId, label: 'Has Member', type: 'Member', color: 'rgba(251,191,36,0.3)' });
                    }
                }
            }

            // Append to existing graph safely
            setGraphData(prev => {
                const newNodesMap = new Map(prev.nodes.map(n => [n.id, n]));

                for (const n of toAddNodes) {
                    if (!newNodesMap.has(n.id)) {
                        newNodesMap.set(n.id, n);
                    } else if (n.id === rootId) {
                        // Upgrade existing node to a root visually once expanded
                        const existing = newNodesMap.get(n.id)!;
                        existing.val = 12;
                        existing.color = '#22d3ee';
                    }
                }

                const newLinks = [...prev.links];
                for (const l of toAddLinks) {
                    // Check duplicate links
                    const exists = newLinks.some(el =>
                        (typeof el.source === 'object' ? (el.source as any).id : el.source) === l.source &&
                        (typeof el.target === 'object' ? (el.target as any).id : el.target) === l.target &&
                        el.type === l.type
                    );
                    if (!exists) newLinks.push(l);
                }

                return { nodes: Array.from(newNodesMap.values()), links: newLinks };
            });

        } catch (error) {
            console.error(error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Apply custom physics parameters to make the graph spread out
    useEffect(() => {
        if (fgRef.current) {
            // Negative charge repels nodes. default is usually around -30.
            fgRef.current.d3Force('charge').strength(-400);
            // Increase link distance
            fgRef.current.d3Force('link').distance(60);
        }
    }, [graphData.nodes.length]); // re-apply if nodes change just in case the engine resets

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!searchQuery) return;
        let targetAddr = searchQuery.trim();
        if (!targetAddr.startsWith("0x") && !targetAddr.startsWith("0X")) {
            targetAddr = "0x" + targetAddr;
        }
        await expandNode(targetAddr);
    };

    const handleClear = () => {
        setGraphData({ nodes: [], links: [] });
    };

    const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
        const isHovered = hoverNode && hoverNode.id === node.id;
        const nodeColor = node.color || '#fff';

        // 1. Draw node circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.val, 0, 2 * Math.PI, false);
        ctx.fillStyle = nodeColor;
        ctx.fill();

        // 2. Draw border
        ctx.lineWidth = isHovered ? 2 : 1;
        ctx.strokeStyle = isHovered ? nodeColor : 'rgba(255, 255, 255, 0.3)';
        ctx.stroke();

        // 3. Draw text label
        // We only draw text if we are zoomed in enough, OR if the node is big, or hovered
        if (globalScale > 0.8 || node.val >= 12 || isHovered) {
            const label = node.name;
            const fontSize = isHovered ? Math.max(14 / globalScale, 4) : Math.max(10 / globalScale, 3);
            ctx.font = `${fontSize}px Sans-Serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillStyle = isHovered ? nodeColor : 'rgba(255,255,255,0.8)';
            ctx.fillText(label, node.x, node.y + node.val + (isHovered ? 4 : 2));
        }
    }, [hoverNode]);

    const handleZoomIn = () => {
        if (fgRef.current) fgRef.current.zoom(fgRef.current.zoom() * 1.5, 400);
    };

    const handleZoomOut = () => {
        if (fgRef.current) fgRef.current.zoom(fgRef.current.zoom() / 1.5, 400);
    };

    const handleFit = () => {
        if (fgRef.current) fgRef.current.zoomToFit(400);
    };

    return (
        <div className="w-full h-full relative bg-[#0e1620] overflow-hidden">
            {/* Ambient Background Effects */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60%] h-[60%] bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none mix-blend-screen opacity-40 z-0" />

            {/* HUD: Toolbars & Search */}
            <div className="absolute top-6 left-6 z-20 flex flex-col gap-4 w-80">
                <form onSubmit={handleSearch} className="flex items-center bg-[#0a0f16]/90 backdrop-blur-xl border border-white/5 rounded-xl px-4 py-3 shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
                    <Search size={18} className="text-cyan-400 mr-3 drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]" />
                    <input
                        type="text"
                        placeholder="Search Node or Address..."
                        className="flex-1 bg-transparent border-none outline-none text-slate-200 text-sm placeholder:text-slate-600 focus:ring-0"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </form>

                {/* Legend or Quick Actions could go here */}
                <div className="bg-[#0a0f16]/90 backdrop-blur-xl border border-white/5 rounded-xl p-4 shadow-[0_4px_20px_rgba(0,0,0,0.5)] relative">
                    <h4 className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-3 flex items-center gap-2">
                        <Activity size={12} className="text-cyan-400" />
                        Graph Controls
                    </h4>
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-300 flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]"></div> Inheritance</span>
                        <span className="text-xs text-slate-300 flex items-center gap-2 ml-4"><div className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]"></div> Member</span>
                    </div>

                    <button
                        onClick={handleClear}
                        className="absolute right-3 top-3 p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded transition-all flex items-center justify-center"
                        title="Clear Graph Canvas"
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            </div>

            {/* View Controls (Bottom Right) */}
            <div className="absolute bottom-6 right-6 z-20 flex flex-col gap-2 bg-[#0a0f16]/90 backdrop-blur-xl border border-white/5 rounded-lg p-1.5 shadow-[0_4px_20px_rgba(0,0,0,0.5)]">
                <button onClick={handleZoomIn} className="p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded transition-all"><ZoomIn size={18} /></button>
                <button onClick={handleZoomOut} className="p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded transition-all"><ZoomOut size={18} /></button>
                <div className="w-full h-px bg-white/5 my-1" />
                <button onClick={handleFit} className="p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded transition-all"><Maximize size={18} /></button>
            </div>

            {/* The Actual Graph */}
            <div className="absolute inset-0 z-10 cursor-move">
                <ForceGraph2D
                    ref={fgRef}
                    graphData={graphData}
                    nodeLabel={() => ""} // Disable default text tooltip
                    nodeCanvasObject={paintNode}
                    linkColor={(link: any) => link.color || 'rgba(34,211,238,0.3)'}
                    linkWidth={1.5}
                    linkDirectionalArrowLength={3.5}
                    linkDirectionalArrowRelPos={1}
                    backgroundColor="transparent"
                    onNodeHover={(node: any) => setHoverNode(node || null)}
                    onNodeClick={(node: any) => {
                        if (fgRef.current) {
                            fgRef.current.centerAt(node.x, node.y, 400);
                        }
                        // Click to expand!
                        expandNode("0x" + node.id);
                    }}
                />
            </div>

            {/* Hover Detail Panel (Top Right) */}
            {hoverNode && (
                <div className="absolute top-6 right-6 z-30 w-72 bg-[#0a0f16]/95 backdrop-blur-xl border border-cyan-500/30 rounded-xl p-5 shadow-[0_0_30px_rgba(6,182,212,0.15)] pointer-events-none transition-all duration-200">
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2 mb-1">
                            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
                            <h3 className="text-[10px] uppercase tracking-widest text-cyan-400 font-bold">Node Details</h3>
                        </div>
                        <span className="text-sm font-bold text-white break-all">{hoverNode.name}</span>
                        <div className="w-full h-px bg-white/5 my-1" />
                        <div className="flex justify-between items-center">
                            <span className="text-[10px] text-slate-500 uppercase tracking-wider">Type</span>
                            <span className="text-[11px] text-amber-300 font-mono">{hoverNode.type}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-[10px] text-slate-500 uppercase tracking-wider">Address</span>
                            <span className="text-[11px] text-slate-300 font-mono">0x{hoverNode.id.toUpperCase()}</span>
                        </div>
                        <div className="w-full h-px bg-white/5 my-1" />
                        <span className="text-[9px] text-slate-400 text-center uppercase tracking-widest mt-1">Left Click to Expand Node</span>
                    </div>
                </div>
            )}

            {graphData.nodes.length === 0 && !isLoading && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center pointer-events-none">
                    <Activity size={48} className="text-cyan-500/20 mb-4 animate-pulse" />
                    <p className="text-slate-500 font-medium tracking-wide">Search for an Object Address to begin tracing</p>
                </div>
            )}
        </div>
    );
}
