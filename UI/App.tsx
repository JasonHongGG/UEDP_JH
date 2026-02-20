import { useState, useEffect } from "react";
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
  { id: '8', name: 'ParseFNamePool', category: 'Info', enabled: true, status: 'running' },
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

  // Simulate some background progress for aesthetic testing (removed NamePool logic here since it's now real)
  useEffect(() => {
    const timer = setInterval(() => {
      setObjCurrentProgress(p => p >= 100 ? 0 : p + (Math.random() * 10));
      setObjTotalProgress(p => p >= 100 ? 100 : p + (Math.random() * 2));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

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

    return () => {
      unlistenProcess.then(f => f());
      unlistenFNamePool.then(f => f());
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
        const count: number = await invoke('parse_fname_pool');
        console.log("[ FNamePool Quantity ]", count);
      } else if (func.name === 'GetGUObjectArray') {
        const addr: number = await invoke('get_guobject_array_address');
        console.log("GUObjectArray Base:", "0x" + addr.toString(16).toUpperCase());
      } else if (func.name === 'GetGWorld') {
        const addr: number = await invoke('get_gworld_address');
        console.log("GWorld Base:", "0x" + addr.toString(16).toUpperCase());
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

  const handleRunAllEnabled = () => {
    console.log("Running all enabled sequentially...");
    const toRun = functions.filter(f => f.enabled).map(f => f.id);
    let delay = 0;
    toRun.forEach(id => {
      setTimeout(() => {
        setFunctions(funcs => funcs.map(f => f.id === id ? { ...f, status: 'running' } : f));
      }, delay);
      delay += 1500;
      setTimeout(() => {
        setFunctions(funcs => funcs.map(f => f.id === id ? { ...f, status: 'done' } : f));
      }, delay);
      delay += 500;
    });
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
      />
    </MainLayout>
  );
}
