import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ApiPropertyInfo {
    property_name: string;
    property_type: string;
    offset: string;
    sub_type: string;
    memory_address: string;
    live_value: string;
    is_object: boolean;
    object_instance_address?: string;
    object_class_address?: string;
    full_path: string;
    is_auto_generated?: boolean;
}

export interface ApiClassData {
    classObjectName: string;
    classObjectId: string;
    parameters: ApiPropertyInfo[];
}

export interface ApiInstanceGroup {
    instanceAddress: string;
    instanceName: string;
    instanceObjectId: string;
    classObjectAddress: string;
    classObjectId: string;
    classObjectName: string;
    data: ApiClassData[];
}

export interface ApiPanelState {
    apiGroups: Record<string, ApiInstanceGroup>;
    serverRunning: boolean;
    serverPort: number;

    addParameter: (
        instanceInfo: Omit<ApiInstanceGroup, 'data'>,
        classInfo: { classObjectName: string; classObjectId: string },
        parameter: ApiPropertyInfo
    ) => void;
    removeParameter: (instanceObjectId: string, classObjectId: string, fullPath: string) => void;
    removeInstanceGroup: (instanceObjectId: string) => void;
    setServerRunning: (running: boolean) => void;
    setServerPort: (port: number) => void;
    updateInstanceAddress: (instanceObjectId: string, newAddress: string) => void;
    importGroups: (groups: Record<string, ApiInstanceGroup>) => void;
    clearAllInstanceAddresses: () => void;
}

export const useApiStore = create<ApiPanelState>()(
    persist(
        (set) => ({
            apiGroups: {},
            serverRunning: false,
            serverPort: 3030,

            addParameter: (instanceInfo, classInfo, parameter) => set((state) => {
                if (Array.isArray(state.apiGroups)) return { apiGroups: {} };

                const newGroups = { ...state.apiGroups };
                const instId = instanceInfo.instanceObjectId;

                // Create instance group if not exists, otherwise clone
                let instanceGroup;
                if (!newGroups[instId]) {
                    instanceGroup = {
                        ...instanceInfo,
                        data: []
                    };
                } else {
                    instanceGroup = { ...newGroups[instId], data: [...newGroups[instId].data] };
                }
                newGroups[instId] = instanceGroup;

                let classDataIndex = instanceGroup.data.findIndex(d => d.classObjectId === classInfo.classObjectId);

                // Create class data layer if not exists
                if (classDataIndex === -1) {
                    instanceGroup.data.push({
                        classObjectName: classInfo.classObjectName,
                        classObjectId: classInfo.classObjectId,
                        parameters: []
                    });
                    classDataIndex = instanceGroup.data.length - 1; // It's now the last element
                } else {
                    // Clone the classData
                    instanceGroup.data[classDataIndex] = { ...instanceGroup.data[classDataIndex], parameters: [...instanceGroup.data[classDataIndex].parameters] };
                }

                const classData = instanceGroup.data[classDataIndex];
                const existingParamIndex = classData.parameters.findIndex(p => p.full_path === parameter.full_path);

                // Add or update parameter
                if (existingParamIndex >= 0) {
                    // Update to manual if it was auto-generated
                    if (!parameter.is_auto_generated) {
                        classData.parameters[existingParamIndex] = { ...classData.parameters[existingParamIndex], is_auto_generated: false };
                    }
                } else {
                    classData.parameters.push(parameter);
                }

                return { apiGroups: newGroups };
            }),

            removeParameter: (instanceObjectId, classObjectId, fullPath) => set((state) => {
                if (Array.isArray(state.apiGroups)) return { apiGroups: {} };

                const newGroups = { ...state.apiGroups };
                const group = newGroups[instanceObjectId];
                if (!group) return state;

                // Clone for immutability
                const newGroup = { ...group, data: [...group.data] };
                newGroups[instanceObjectId] = newGroup;

                const classDataIndex = newGroup.data.findIndex(d => d.classObjectId === classObjectId);
                if (classDataIndex === -1) return state;

                const classData = { ...newGroup.data[classDataIndex] };
                newGroup.data[classDataIndex] = classData;

                // Cleanup auto-generated parameters: Keep an auto-generated parameter ONLY if there is at least one manual parameter that is a descendant
                let newParams = classData.parameters.filter(p => p.full_path !== fullPath);
                newParams = newParams.filter(p => {
                    if (!p.is_auto_generated) return true; // Keep all manual ones
                    return newParams.some(child => !child.is_auto_generated && child.full_path.startsWith(p.full_path + '.'));
                });

                classData.parameters = newParams;

                // Clean up empty class layers
                if (classData.parameters.length === 0) {
                    newGroup.data.splice(classDataIndex, 1);
                }

                // Clean up empty instance groups
                if (newGroup.data.length === 0) {
                    delete newGroups[instanceObjectId];
                }

                return { apiGroups: newGroups };
            }),

            removeInstanceGroup: (instanceObjectId) => set((state) => {
                const newGroups = { ...state.apiGroups };
                delete newGroups[instanceObjectId];
                return { apiGroups: newGroups };
            }),

            setServerRunning: (running) => set({ serverRunning: running }),
            setServerPort: (port) => set({ serverPort: port }),

            updateInstanceAddress: (instanceObjectId, newAddress) => set((state) => {
                const newGroups = { ...state.apiGroups };
                if (newGroups[instanceObjectId]) {
                    newGroups[instanceObjectId] = { ...newGroups[instanceObjectId], instanceAddress: newAddress };
                }
                return { apiGroups: newGroups };
            }),

            importGroups: (groups) => set({
                // Reset all instance addresses to N/A on import
                apiGroups: Object.fromEntries(
                    Object.entries(groups).map(([id, group]) => [
                        id,
                        { ...group, instanceAddress: "N/A" }
                    ])
                )
            }),

            clearAllInstanceAddresses: () => set((state) => {
                if (Array.isArray(state.apiGroups)) return { apiGroups: {} };

                const newGroups = { ...state.apiGroups };
                for (const key in newGroups) {
                    if (!newGroups[key] || !Array.isArray(newGroups[key].data)) {
                        delete newGroups[key];
                    } else {
                        newGroups[key] = { ...newGroups[key], instanceAddress: "N/A" };
                    }
                }
                return { apiGroups: newGroups };
            })
        }),
        {
            name: 'api-panel-storage',
            partialize: (state) => ({
                apiGroups: state.apiGroups,
                serverPort: state.serverPort
            }),
            onRehydrateStorage: () => (state) => {
                if (state) {
                    setTimeout(() => {
                        state.clearAllInstanceAddresses();
                    }, 0);
                }
            }
        }
    )
);
