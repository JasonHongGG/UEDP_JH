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
    object_instance_address: string;
    object_class_address: string;
    full_path: string;
    is_auto_generated?: boolean;
}

export interface ApiGroup {
    id: string;
    classObjectName: string;
    classObjectId: string;
    instanceName: string;
    instanceObjectId: string;
    parameters: ApiPropertyInfo[];
}

export interface ApiPanelState {
    apiGroups: ApiGroup[];
    serverRunning: boolean;
    serverPort: number;

    addParameter: (
        groupInfo: Omit<ApiGroup, 'parameters' | 'id'>,
        parameter: ApiPropertyInfo
    ) => void;
    removeParameter: (groupId: string, fullPath: string) => void;
    removeGroup: (groupId: string) => void;
    setServerRunning: (running: boolean) => void;
    setServerPort: (port: number) => void;
    updateInstanceAddress: (groupId: string, newAddress: string) => void;
    importGroups: (groups: ApiGroup[]) => void;
}

export const useApiStore = create<ApiPanelState>()(
    persist(
        (set) => ({
            apiGroups: [],
            serverRunning: false,
            serverPort: 3030,

            addParameter: (groupInfo, parameter) => set((state) => {
                const groupId = groupInfo.instanceObjectId; // Group by root instance address
                const existingGroupIndex = state.apiGroups.findIndex(g => g.id === groupId);

                if (existingGroupIndex >= 0) {
                    const updatedGroups = [...state.apiGroups];
                    const group = updatedGroups[existingGroupIndex];

                    const existingParamIndex = group.parameters.findIndex(p => p.property_name === parameter.property_name && p.full_path === parameter.full_path);

                    if (existingParamIndex >= 0) {
                        // If it exists, and the incoming parameter is NOT auto-generated, upgrade it to manual
                        if (!parameter.is_auto_generated) {
                            group.parameters[existingParamIndex] = { ...group.parameters[existingParamIndex], is_auto_generated: false };
                        }
                    } else {
                        group.parameters.push(parameter);
                    }
                    return { apiGroups: updatedGroups };
                } else {
                    const newGroup: ApiGroup = {
                        id: groupId,
                        ...groupInfo,
                        parameters: [parameter]
                    };
                    return { apiGroups: [...state.apiGroups, newGroup] };
                }
            }),

            removeParameter: (groupId, fullPath) => set((state) => ({
                apiGroups: state.apiGroups.map(group => {
                    if (group.id === groupId) {
                        let newParams = group.parameters.filter(p => p.full_path !== fullPath);

                        // Cleanup auto-generated parameters: 
                        // Keep an auto-generated parameter ONLY if there is at least one manual parameter that is a descendant
                        newParams = newParams.filter(p => {
                            if (!p.is_auto_generated) return true; // Keep all manual ones

                            // Check if this auto-generated parameter is a prefix for any remaining manual parameter
                            return newParams.some(child => !child.is_auto_generated && child.full_path.startsWith(p.full_path + '.'));
                        });

                        return {
                            ...group,
                            parameters: newParams
                        };
                    }
                    return group;
                }).filter(group => group.parameters.length > 0)
            })),

            removeGroup: (groupId) => set((state) => ({
                apiGroups: state.apiGroups.filter(g => g.id !== groupId)
            })),

            setServerRunning: (running: boolean) => set({ serverRunning: running }),

            setServerPort: (port: number) => set({ serverPort: port }),

            updateInstanceAddress: (groupId, newAddress) => set((state) => ({
                apiGroups: state.apiGroups.map(group =>
                    group.id === groupId ? { ...group, instanceObjectId: newAddress } : group
                )
            })),

            importGroups: (groups) => set({ apiGroups: groups }),
        }),
        {
            name: 'api-panel-storage',
            partialize: (state) => ({
                apiGroups: state.apiGroups,
                serverPort: state.serverPort
            }),
        }
    )
);
