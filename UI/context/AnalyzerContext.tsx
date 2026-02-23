import { createContext, useContext, useState, ReactNode } from 'react';

export interface RawObjectInfo {
    object_id: number;
    type_name: string;
    name: string;
    full_name: string;
    address: string;
    offset: string;
    class_ptr: string;
    outer_ptr: string;
    super_ptr: string;
    prop_size: string;
    prop_0: string;
    prop_8: string;
    function_ptr: string;
    member_ptr: string;
    member_size: string;
    bit_mask: string;
}

interface AnalyzerState {
    // FName Decoder
    fnameInput: string;
    setFnameInput: (v: string) => void;
    fnameResult: { name?: string; error?: string } | null;
    setFnameResult: (v: { name?: string; error?: string } | null) => void;
    fnameMode: 'hex' | 'int';
    setFnameMode: (v: 'hex' | 'int') => void;

    // Object Diagnostics
    objInput: string;
    setObjInput: (v: string) => void;
    objResult: { data?: RawObjectInfo; error?: string } | null;
    setObjResult: (v: { data?: RawObjectInfo; error?: string } | null) => void;
}

const AnalyzerContext = createContext<AnalyzerState | null>(null);

export function AnalyzerProvider({ children }: { children: ReactNode }) {
    const [fnameInput, setFnameInput] = useState('');
    const [fnameResult, setFnameResult] = useState<{ name?: string; error?: string } | null>(null);
    const [fnameMode, setFnameMode] = useState<'hex' | 'int'>('hex');
    const [objInput, setObjInput] = useState('');
    const [objResult, setObjResult] = useState<{ data?: RawObjectInfo; error?: string } | null>(null);

    return (
        <AnalyzerContext.Provider value={{
            fnameInput, setFnameInput, fnameResult, setFnameResult, fnameMode, setFnameMode,
            objInput, setObjInput, objResult, setObjResult,
        }}>
            {children}
        </AnalyzerContext.Provider>
    );
}

export function useAnalyzer() {
    const ctx = useContext(AnalyzerContext);
    if (!ctx) throw new Error('useAnalyzer must be used within AnalyzerProvider');
    return ctx;
}
