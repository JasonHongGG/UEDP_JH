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
    full_path: string; // Helps reconstruct the tree if needed
}

export interface ApiGroup {
    id: string; // Usually the class address or a unique identifier
    classObjectName: string;
    classObjectId: string;
    instanceName: string;
    instanceObjectId: string; // Memory address of the instance
    parameters: ApiPropertyInfo[];
}

export interface ApiPanelState {
    apiGroups: ApiGroup[];
    serverRunning: boolean;
    serverPort: number;

    // Actions
    addParameter: (
        groupInfo: Omit<ApiGroup, 'parameters' | 'id'>,
        parameter: ApiPropertyInfo
    ) => void;
    removeParameter: (groupId: string, propertyName: string) => void;
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
            serverRunning: false, // We don't persist running state to auto-start blindly, usually better to let user start
            serverPort: 3030,

            addParameter: (groupInfo, parameter) => set((state) => {
                const groupId = groupInfo.classObjectId; // Using class ID as the unique group identifier
                const existingGroupIndex = state.apiGroups.findIndex(g => g.id === groupId);

                if (existingGroupIndex >= 0) {
                    // Group exists, check if parameter already exists
                    const updatedGroups = [...state.apiGroups];
                    const group = updatedGroups[existingGroupIndex];

                    const paramExists = group.parameters.some(p => p.property_name === parameter.property_name && p.full_path === parameter.full_path);

                    if (!paramExists) {
                        group.parameters.push(parameter);
                    }
                    return { apiGroups: updatedGroups };
                } else {
                    // Create new group
                    const newGroup: ApiGroup = {
                        id: groupId,
                        ...groupInfo,
                        parameters: [parameter]
                    };
                    return { apiGroups: [...state.apiGroups, newGroup] };
                }
            }),

            removeParameter: (groupId, propertyName) => set((state) => ({
                apiGroups: state.apiGroups.map(group => {
                    if (group.id === groupId) {
                        return {
                            ...group,
                            parameters: group.parameters.filter(p => p.property_name !== propertyName)
                        };
                    }
                    return group;
                }).filter(group => group.parameters.length > 0) // Optional: remove empty groups
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
            }), // Only persist these fields
        }
    )
);
