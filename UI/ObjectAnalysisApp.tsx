import { useState } from 'react';
import { PackageViewer } from './components/features/PackageViewer';
import { Inspector } from './components/features/Inspector';
import { TitleBar, TabDef, TabId } from './components/layout/TitleBar';
import { Boxes, ScanEye } from 'lucide-react';

const TABS: TabDef[] = [
    { id: 'package-viewer', label: 'Viewer', icon: <Boxes size={14} /> },
    { id: 'inspector', label: 'Inspector', icon: <ScanEye size={14} /> },
];

export default function ObjectAnalysisApp() {
    const [activeTab, setActiveTab] = useState<TabId>('package-viewer');

    return (
        <div className="h-screen w-screen bg-slate-900 text-slate-200 flex flex-col font-sans overflow-hidden border border-slate-700/50 rounded-xl shadow-2xl">
            {/* Custom Interactive Title Bar with Integrated Tabs */}
            <TitleBar tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} />

            {/* Content Area — fills all remaining space */}
            <div className="flex-1 min-h-0 overflow-hidden relative z-10 bg-slate-900">
                <div className={`w-full h-full ${activeTab === 'package-viewer' ? 'block' : 'hidden'}`}>
                    <PackageViewer />
                </div>
                <div className={`w-full h-full ${activeTab === 'inspector' ? 'block' : 'hidden'}`}>
                    <Inspector />
                </div>
            </div>
        </div>
    );
}
