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

  const [namePoolProgress, setNamePoolProgress] = useState(0);
  const [objCurrentProgress, setObjCurrentProgress] = useState(0);
  const [objTotalProgress, setObjTotalProgress] = useState(0);

  // Simulate some background progress for aesthetic testing
  useEffect(() => {
    const timer = setInterval(() => {
      setNamePoolProgress(p => p >= 100 ? 100 : p + (Math.random() * 5));
      setObjCurrentProgress(p => p >= 100 ? 0 : p + (Math.random() * 10));
      setObjTotalProgress(p => p >= 100 ? 100 : p + (Math.random() * 2));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Listen for process selection from the standalone window
  useEffect(() => {
    const unlisten = listen<{ processName: string, pid: number }>('process-selected', async (event) => {
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

    return () => {
      unlisten.then(f => f());
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
      } else if (func.name === 'GetFNamePool') {
        const addr: number = await invoke('get_fname_pool_address');
        console.log("FNamePool Base:", "0x" + addr.toString(16).toUpperCase());
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
        namePoolProgress={namePoolProgress}
        objectPoolCurrentProgress={objCurrentProgress}
        objectPoolTotalProgress={objTotalProgress}
      />
    </MainLayout>
  );
}
