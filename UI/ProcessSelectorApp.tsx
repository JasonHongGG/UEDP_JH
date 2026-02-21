import { useState, useMemo, useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import './App.css';

interface Process {
    pid: number;
    name: string;
}

export default function ProcessSelectorApp() {
    const [processes, setProcesses] = useState<Process[]>([]);
    const [search, setSearch] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const filteredProcesses = useMemo(() => {
        return processes.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
    }, [search, processes]);

    // Reset selection when search changes
    useEffect(() => {
        setSelectedIndex(0);
    }, [search]);

    // Auto-focus input on mount and fetch processes
    useEffect(() => {
        // slight delay to ensure window is focused
        setTimeout(() => inputRef.current?.focus(), 50);

        // Fetch the real processes from the Rust backend
        invoke<Process[]>('fetch_system_processes')
            .then((data) => {
                setProcesses(data);
            })
            .catch(err => console.error("Failed to fetch processes:", err));

        // Hide when focus is lost (user clicked elsewhere)
        // Delay to avoid firing during the initial window show animation
        const win = getCurrentWindow();
        let unlisten: (() => void) | null = null;
        const timer = setTimeout(() => {
            win.onFocusChanged(({ payload: focused }) => {
                if (!focused) win.hide();
            }).then(fn => { unlisten = fn; });
        }, 300);

        return () => { clearTimeout(timer); if (unlisten) unlisten(); };
    }, []);

    const appWindow = getCurrentWindow();

    const handleSelect = async (processName: string, pid: number) => {
        // 1. Emit the selection event globally to the main window
        await emit('process-selected', { processName, pid });
        // 2. Hide this window (keep it alive in background for fast re-opening)
        await appWindow.hide();
        // 3. Clear search for next time
        setSearch('');
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            appWindow.hide();
            return;
        }

        if (filteredProcesses.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => Math.min(prev + 1, filteredProcesses.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => Math.max(prev - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const selected = filteredProcesses[selectedIndex];
            if (selected) {
                handleSelect(selected.name, selected.pid);
            }
        }
    };

    // Scroll selected item into view automatically
    useEffect(() => {
        if (listRef.current) {
            const selectedElement = listRef.current.children[selectedIndex] as HTMLElement;
            if (selectedElement) {
                selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    }, [selectedIndex]);

    return (
        <div data-tauri-drag-region className="w-full h-screen bg-slate-900/95 backdrop-blur-2xl border border-slate-700/50 rounded-xl flex flex-col overflow-hidden shadow-2xl font-sans text-slate-200 select-none">

            {/* Search Input Area */}
            <div data-tauri-drag-region className="flex items-center px-4 py-4 border-b border-slate-700/50">
                <Search size={22} className="text-blue-500 mr-3 pointer-events-none" />
                <input
                    ref={inputRef}
                    type="text"
                    placeholder="Search attached processes..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="flex-1 bg-transparent text-xl font-medium text-slate-100 placeholder:text-slate-500/70 focus:outline-none focus:ring-0"
                    autoFocus
                />
            </div>

            {/* List Area */}
            <div className="flex-1 overflow-y-auto w-full custom-scrollbar py-2" ref={listRef}>
                {filteredProcesses.length > 0 ? (
                    filteredProcesses.map((p, idx) => (
                        <div
                            key={p.pid}
                            onClick={() => handleSelect(p.name, p.pid)}
                            onMouseEnter={() => setSelectedIndex(idx)}
                            className={`px-4 py-3 mx-2 my-1 rounded-lg cursor-pointer transition-all duration-150 flex items-center justify-between ${selectedIndex === idx
                                ? 'bg-blue-600 shadow-md text-white'
                                : 'hover:bg-slate-800 text-slate-300'
                                }`}
                        >
                            <span className={`text-base font-medium truncate pr-4 ${selectedIndex === idx ? 'text-white' : 'text-slate-300'}`}>
                                {p.name}
                            </span>
                            <span className={`text-xs whitespace-nowrap px-2 py-0.5 rounded font-mono ${selectedIndex === idx ? 'bg-blue-800 text-blue-100' : 'bg-slate-800 text-slate-400'}`}>
                                PID: {p.pid}
                            </span>
                        </div>
                    ))
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-3">
                        <Search size={32} className="opacity-20" />
                        <span className="text-sm font-medium">No active process found</span>
                    </div>
                )}
            </div>

            <div className="px-4 py-2 border-t border-slate-700/50 bg-slate-900/50 text-[10px] text-slate-500 flex justify-between items-center">
                <span>Use <kbd className="font-sans px-1 py-0.5 bg-slate-800 rounded">↑</kbd> <kbd className="font-sans px-1 py-0.5 bg-slate-800 rounded">↓</kbd> to navigate</span>
                <span>Press <kbd className="font-sans px-1 py-0.5 bg-slate-800 rounded">Enter</kbd> to select, <kbd className="font-sans px-1 py-0.5 bg-slate-800 rounded">Esc</kbd> to close</span>
            </div>
        </div>
    );
}
