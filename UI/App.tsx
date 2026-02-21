import { useState, useEffect, useRef } from "react";
import { MainLayout } from "./components/layout/MainLayout";
import { TopBar } from "./components/features/TopBar";
import { FunctionTable, AnalyzerFunction } from "./components/features/FunctionTable";
import { ProgressPanel } from "./components/features/ProgressPanel";
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

const INITIAL_FUNCTIONS: AnalyzerFunction[] = [
  { id: '1', name: 'ShowBaseAddress', category: 'Info', enabled: false, status: 'idle' },
  { id: '3', name: 'AutoConfig', category: 'Auto', enabled: false, status: 'idle' },
  { id: '4', name: 'GetUEVersion', category: 'Info', enabled: false, status: 'idle' },
  { id: '5', name: 'GetFNamePool', category: 'Info', enabled: true, status: 'idle' },
  { id: '6', name: 'GetGUObjectArray', category: 'Info', enabled: true, status: 'idle' },
  { id: '7', name: 'GetGWorld', category: 'Info', enabled: false, status: 'idle' },
  { id: '8', name: 'ParseFNamePool', category: 'Info', enabled: true, status: 'idle' },
  { id: '9', name: 'ParseGUObjectArray', category: 'Info', enabled: true, status: 'idle' },
];

export default function App() {
  const [attachedProcess, setAttachedProcess] = useState<string | null>(null);
  const [functions, setFunctions] = useState<AnalyzerFunction[]>(INITIAL_FUNCTIONS);

  const [namePoolChunkProgress, setNamePoolChunkProgress] = useState(0);
  const [namePoolTotalProgress, setNamePoolTotalProgress] = useState(0);
  const [namePoolCount, setNamePoolCount] = useState({ current: 0, total: 0 });
  const [namePoolChunkCount, setNamePoolChunkCount] = useState({ current: 0, total: 0 });

  const [objCurrentProgress, setObjCurrentProgress] = useState(0);
  const [objTotalProgress, setObjTotalProgress] = useState(0);
  const [objCurrentCount, setObjCurrentCount] = useState({ current: 0, total: 0 });
  const [objTotalCount, setObjTotalCount] = useState({ current: 0, total: 0 });

  // Sequence timer
  const [seqElapsed, setSeqElapsed] = useState<number | null>(null);  // ms, null = not run yet
  const [seqRunning, setSeqRunning] = useState(false);
  const seqStartRef = useRef<number>(0);
  const seqTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // (Mock timers removed — progress is now driven by real Rust backend events)

  // Listen for process selection from the standalone window and progress updates
  useEffect(() => {
    const unlistenProcess = listen<{ processName: string, pid: number }>('process-selected', async (event) => {
      const { processName, pid } = event.payload;
      try {
        const result = await invoke<string>('attach_to_process', { pid, name: processName });
        console.log(result);
        setAttachedProcess(processName);
      } catch (err) {
        console.error("Failed to attach:", err);
        setAttachedProcess(null);
      }
    });

    const unlistenFNamePool = listen<{ current_chunk: number, total_chunks: number, current_names: number, total_names: number }>('fname-pool-progress', (event) => {
      const { current_chunk, total_chunks, current_names, total_names } = event.payload;
      setNamePoolChunkProgress((current_chunk / total_chunks) * 100);
      setNamePoolTotalProgress((current_names / total_names) * 100);
      setNamePoolCount({ current: current_names, total: total_names });
      setNamePoolChunkCount({ current: current_chunk, total: total_chunks });
    });

    const unlistenGUObject = listen<{ current_chunk: number, total_chunks: number, current_objects: number, total_objects: number }>('guobject-array-progress', (event) => {
      const { current_chunk, total_chunks, current_objects, total_objects } = event.payload;
      setObjCurrentProgress((current_chunk / total_chunks) * 100);
      setObjTotalProgress((current_objects / total_objects) * 100);
      setObjCurrentCount({ current: current_chunk, total: total_chunks });
      setObjTotalCount({ current: current_objects, total: total_objects });
    });

    return () => {
      unlistenProcess.then(f => f());
      unlistenFNamePool.then(f => f());
      unlistenGUObject.then(f => f());
    };
  }, []);

  const handleOpenSelector = async () => {
    try {
      const selectorWindow = await WebviewWindow.getByLabel('process-selector');
      if (selectorWindow) {
        await selectorWindow.show();
        await selectorWindow.setFocus();
      }
    } catch (error) {
      console.error("Failed to open selector window:", error);
    }
  };

  const handleToggleFunction = (id: string) => {
    setFunctions(funcs =>
      funcs.map(f => f.id === id ? { ...f, enabled: !f.enabled } : f)
    );
  };

  const handleRunSingle = async (id: string) => {
    const func = functions.find(f => f.id === id);
    if (!func) return;

    console.log(`Running single function: ${func.name}`);

    setFunctions(funcs =>
      funcs.map(f => f.id === id ? { ...f, status: 'running' } : f)
    );

    try {
      if (func.name === 'ShowBaseAddress') {
        const result: string = await invoke('show_base_address');
        console.log("=== Base Addresses ===");
        console.log(result);
        console.log("======================");
      } else if (func.name === 'GetUEVersion') {
        const version: string = await invoke('get_ue_version');
        console.log("[ UE Version ]", version);
      } else if (func.name === 'GetFNamePool') {
        const addr: number = await invoke('get_fname_pool_address');
        console.log("FNamePool Base:", "0x" + addr.toString(16).toUpperCase());
      } else if (func.name === 'ParseFNamePool') {
        // Reset bars before starting
        setNamePoolChunkProgress(0); setNamePoolTotalProgress(0);
        setNamePoolChunkCount({ current: 0, total: 0 }); setNamePoolCount({ current: 0, total: 0 });
        const count: number = await invoke('parse_fname_pool');
        console.log("[ FNamePool Quantity ]", count);
        // Force bars to 100% on completion
        setNamePoolChunkProgress(100);
        setNamePoolTotalProgress(100);
        setNamePoolChunkCount(prev => ({ ...prev, current: prev.total }));
      } else if (func.name === 'GetGUObjectArray') {
        const addr: number = await invoke('get_guobject_array_address');
        console.log("GUObjectArray Base:", "0x" + addr.toString(16).toUpperCase());
      } else if (func.name === 'GetGWorld') {
        const addr: number = await invoke('get_gworld_address');
        console.log("GWorld Base:", "0x" + addr.toString(16).toUpperCase());
      } else if (func.name === 'ParseGUObjectArray') {
        // Reset bars before starting
        setObjCurrentProgress(0); setObjTotalProgress(0);
        setObjCurrentCount({ current: 0, total: 0 }); setObjTotalCount({ current: 0, total: 0 });
        const count: number = await invoke('parse_guobject_array');
        console.log("[ GUObjectArray Total Objects ]", count);
        // Force bars to 100% on completion
        setObjCurrentProgress(100);
        setObjTotalProgress(100);
        setObjCurrentCount(c => ({ current: c.total, total: c.total }));
        setObjTotalCount({ current: count, total: count });
      } else {
        // Simulate finish for others
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      setFunctions(funcs =>
        funcs.map(f => f.id === id ? { ...f, status: 'done' } : f)
      );
    } catch (err) {
      console.error(`Error running ${func.name}:`, err);
      setFunctions(funcs =>
        funcs.map(f => f.id === id ? { ...f, status: 'error' } : f)
      );
    }
  };

  const handleRunAllEnabled = async () => {
    console.log("Running all enabled sequentially...");
    // Start timer
    seqStartRef.current = Date.now();
    setSeqElapsed(0);
    setSeqRunning(true);
    if (seqTimerRef.current) clearInterval(seqTimerRef.current);
    seqTimerRef.current = setInterval(() => {
      setSeqElapsed(Date.now() - seqStartRef.current);
    }, 100);

    const toRun = functions.filter(f => f.enabled).map(f => f.id);
    for (const id of toRun) {
      await handleRunSingle(id);
    }

    // Stop timer
    if (seqTimerRef.current) { clearInterval(seqTimerRef.current); seqTimerRef.current = null; }
    setSeqElapsed(Date.now() - seqStartRef.current);
    setSeqRunning(false);
  };

  return (
    <MainLayout>
      <TopBar
        attachedProcess={attachedProcess}
        onOpenSelector={handleOpenSelector}
        onRunAllEnabled={handleRunAllEnabled}
      />

      <FunctionTable
        functions={functions}
        onToggle={handleToggleFunction}
        onRunSingle={handleRunSingle}
      />

      <ProgressPanel
        namePoolChunkProgress={namePoolChunkProgress}
        namePoolTotalProgress={namePoolTotalProgress}
        namePoolCount={namePoolCount}
        namePoolChunkCount={namePoolChunkCount}
        objectPoolCurrentProgress={objCurrentProgress}
        objectPoolTotalProgress={objTotalProgress}
        objectPoolCurrentCount={objCurrentCount}
        objectPoolTotalCount={objTotalCount}
        seqElapsed={seqElapsed}
        seqRunning={seqRunning}
      />
    </MainLayout>
  );
}
