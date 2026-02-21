import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, Copy, X, Activity } from 'lucide-react';

export type TabId = 'package-viewer' | 'inspector';

export interface TabDef {
    id: TabId;
    label: string;
    icon: React.ReactNode;
}

interface TitleBarProps {
    tabs: TabDef[];
    activeTab: TabId;
    onTabChange: (id: TabId) => void;
}

export function TitleBar({ tabs, activeTab, onTabChange }: TitleBarProps) {
    const [isMaximized, setIsMaximized] = useState(false);

    useEffect(() => {
        const checkMaximized = async () => {
            const maximized = await getCurrentWindow().isMaximized();
            setIsMaximized(maximized);
        };
        checkMaximized();

        const unlisten = getCurrentWindow().onResized(() => {
            checkMaximized();
        });

        return () => {
            unlisten.then(f => f());
        };
    }, []);

    const handleMinimize = useCallback(() => {
        getCurrentWindow().minimize();
    }, []);

    const handleMaximize = useCallback(async () => {
        const maximized = await getCurrentWindow().isMaximized();
        if (maximized) {
            await getCurrentWindow().unmaximize();
            setIsMaximized(false);
        } else {
            await getCurrentWindow().maximize();
            setIsMaximized(true);
        }
    }, []);

    const handleClose = useCallback(() => {
        getCurrentWindow().hide(); // Use hide() instead of close() for background process
    }, []);

    // --- Tab Slider Logic ---
    const tabContainerRef = useRef<HTMLDivElement>(null);
    const [sliderStyle, setSliderStyle] = useState({ width: 0, transform: 'translateX(0px)' });

    useEffect(() => {
        if (!tabContainerRef.current) return;

        const activeIndex = tabs.findIndex(t => t.id === activeTab);
        if (activeIndex === -1) return;

        const tabElements = Array.from(tabContainerRef.current.querySelectorAll('.title-tab-btn'));
        const activeElement = tabElements[activeIndex] as HTMLElement;

        if (activeElement) {
            setSliderStyle({
                width: activeElement.offsetWidth,
                transform: `translateX(${activeElement.offsetLeft}px)`,
            });
        }
    }, [activeTab, tabs]);

    return (
        <div
            data-tauri-drag-region
            className="flex items-center justify-between px-3 h-11 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-b border-t-0 border-l-0 border-r-0 border-blue-500/20 backdrop-blur-md shrink-0 select-none overflow-hidden relative"
        >
            {/* Ambient Top Glow */}
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-blue-500/40 to-transparent pointer-events-none"></div>

            {/* Logo and Brand */}
            <div data-tauri-drag-region className="flex items-center gap-3 pointer-events-none relative z-10 w-1/3">
                <div className="relative">
                    {/* Pulsing glow behind the icon */}
                    <div className="absolute -inset-1 rounded-full bg-cyan-400/20 blur-sm animate-pulse"></div>
                    {/* Foreground icon */}
                    <div className="relative flex items-center justify-center p-1.5 bg-slate-800/80 border border-slate-700/50 rounded-lg shadow-[0_0_10px_rgba(34,211,238,0.3)] group">
                        <Activity size={14} className="text-cyan-400 group-hover:scale-110 transition-transform duration-300" />
                    </div>
                </div>

                <div className="flex flex-col justify-center">
                    <span className="text-[10px] uppercase font-bold tracking-[0.2em] bg-clip-text text-transparent bg-gradient-to-r from-slate-200 to-slate-400 drop-shadow-[0_0_8px_rgba(255,255,255,0.2)]">
                        UE Dumper
                    </span>
                </div>
            </div>

            {/* Center: Integrated Tab Bar */}
            <div data-tauri-drag-region className="flex-1 h-full flex items-end justify-center pt-2">
                <div
                    ref={tabContainerRef}
                    className="relative flex items-center bg-slate-800/80 rounded-t-lg border border-b-0 border-slate-700/50 px-1 pt-1 pb-0 shadow-[0_-2px_10px_rgba(0,0,0,0.3)]"
                >
                    {/* The Sliding Indicator (The "pill" active background) */}
                    <div
                        className="absolute top-1 bottom-0 rounded-t-md bg-slate-700 shadow-inner transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)] pointer-events-none"
                        style={{
                            width: sliderStyle.width,
                            transform: sliderStyle.transform,
                        }}
                    >
                        {/* Glowing top edge of the slider to match title bar aesthetics */}
                        <div className="absolute left-1/2 top-0 -translate-x-1/2 w-1/2 h-[1px] bg-cyan-400 rounded-b-full shadow-[0_2px_8px_rgba(34,211,238,0.8)] opacity-100 mix-blend-screen"></div>
                    </div>

                    {tabs.map((tab) => {
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => onTabChange(tab.id)}
                                className={`title-tab-btn relative flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-bold tracking-widest transition-colors duration-200 z-10 rounded-t-md select-none outline-none
                                    ${isActive
                                        ? 'text-white drop-shadow-[0_0_2px_rgba(255,255,255,0.5)]'
                                        : 'text-slate-500 hover:text-slate-300 hover:bg-slate-700/20 active:scale-95'
                                    }
                                `}
                            >
                                <div className={`transition-transform duration-300 ${isActive ? 'scale-110 text-cyan-400 drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]' : ''}`}>
                                    {tab.icon}
                                </div>
                                {tab.label.toUpperCase()}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Window Controls */}
            <div className="flex items-center gap-1.5 w-1/3 justify-end pointer-events-auto z-10">
                {/* Minimize Button */}
                <button
                    onClick={handleMinimize}
                    title="Minimize"
                    className="flex justify-center items-center w-8 h-8 rounded-md bg-transparent text-slate-400 hover:text-amber-400 hover:bg-amber-500/10 border border-transparent hover:border-amber-500/30 hover:shadow-[0_0_8px_rgba(251,191,36,0.3)] transition-all duration-200"
                >
                    <Minus size={14} strokeWidth={2.5} />
                </button>

                {/* Maximize/Restore Button */}
                <button
                    onClick={handleMaximize}
                    title={isMaximized ? "Restore Down" : "Maximize"}
                    className="flex justify-center items-center w-8 h-8 rounded-md bg-transparent text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 border border-transparent hover:border-blue-500/30 hover:shadow-[0_0_8px_rgba(59,130,246,0.3)] transition-all duration-200"
                >
                    {isMaximized ? (
                        <Copy size={12} strokeWidth={2.5} className="rotate-180 transform" />
                    ) : (
                        <Square size={12} strokeWidth={2.5} />
                    )}
                </button>

                {/* Close Button */}
                <button
                    onClick={handleClose}
                    title="Close Window"
                    className="flex justify-center items-center w-8 h-8 rounded-md bg-transparent text-slate-400 hover:text-white hover:bg-rose-600/90 border border-transparent hover:border-rose-500 hover:shadow-[0_0_12px_rgba(225,29,72,0.8)] transition-all duration-200 focus:outline-none ml-1"
                >
                    <X size={15} strokeWidth={2.5} />
                </button>
            </div>
        </div>
    );
}
