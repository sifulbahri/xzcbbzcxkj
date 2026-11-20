import {
  Briefcase,
  CheckSquare,
  FileText,
  LayoutDashboard,
  ListChecks,
  Menu,
  Plus,
  Settings,
  Shield,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ImportJobModal } from './components/ImportJobModal';
import { ApplicationsPage } from './pages/ApplicationsPage';
import { ApprovalQueuePage } from './pages/ApprovalQueuePage';
import { CvManagerPage } from './pages/CvManagerPage';
import { DashboardPage } from './pages/DashboardPage';
import { JobsPage } from './pages/JobsPage';
import { SettingsPage } from './pages/SettingsPage';
import { api } from './services/api';

type NavTab = 'overview' | 'jobs' | 'approval' | 'applications' | 'cv' | 'settings';

const NAV_ITEMS: Array<{ id: NavTab; label: string; Icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Overview', Icon: LayoutDashboard },
  { id: 'jobs', label: 'Job Discovery', Icon: Briefcase },
  { id: 'approval', label: 'Approval Queue', Icon: CheckSquare },
  { id: 'applications', label: 'Applications', Icon: ListChecks },
  { id: 'cv', label: 'CV Manager', Icon: FileText },
  { id: 'settings', label: 'Settings', Icon: Settings },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);

  const [pendingCount, setPendingCount] = useState<number>(0);
  const [jobsCount, setJobsCount] = useState<number>(0);
  const [aiStatusText, setAiStatusText] = useState<string>('Checking backend...');

  const refreshCounts = useCallback(async () => {
    try {
      const [dash, health] = await Promise.all([api.getDashboard(), api.health()]);
      setPendingCount(dash.kpis.awaitingApproval);
      setJobsCount(dash.kpis.totalDiscoveredJobs);
      setAiStatusText(
        health.ai.configured
          ? `${health.ai.activeProvider === 'openai' ? 'OpenAI' : 'Gemini'} Ready`
          : 'AI Key Needed'
      );
    } catch {
      setAiStatusText('Backend Offline');
    }
  }, []);

  useEffect(() => {
    refreshCounts();
  }, [refreshCounts, refreshSignal]);

  function triggerRefresh() {
    setRefreshSignal((prev) => prev + 1);
  }

  const activeTitle = NAV_ITEMS.find((n) => n.id === activeTab)?.label || 'Overview';

  return (
    <div className="min-h-screen bg-[#0B1120] text-slate-100 flex">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Left Sidebar (240px) */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-60 bg-[#0F172A] border-r border-slate-800 flex flex-col transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-16 px-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <Shield className="w-5 h-5 text-sky-400 shrink-0" aria-hidden="true" />
            <span className="font-display text-sm font-semibold text-slate-100 whitespace-nowrap truncate">
              Glints AI Assistant
            </span>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="p-1 text-slate-400 hover:text-slate-100 lg:hidden"
            aria-label="Close navigation"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1" aria-label="Main Navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.Icon;
            const active = activeTab === item.id;
            const count =
              item.id === 'approval' ? pendingCount : item.id === 'jobs' ? jobsCount : null;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md text-xs font-medium transition-colors ${
                  active
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/40'
                }`}
              >
                <span className="flex items-center gap-2.5 whitespace-nowrap">
                  <Icon
                    className={`w-4 h-4 shrink-0 ${active ? 'text-sky-400' : 'text-slate-500'}`}
                    aria-hidden="true"
                  />
                  <span>{item.label}</span>
                </span>
                {count !== null && count > 0 && (
                  <span
                    className={`font-mono tabular-nums text-xs ${
                      item.id === 'approval' ? 'text-amber-400' : 'text-slate-500'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800 text-xs space-y-1">
          <div className="text-slate-400">Jakarta Security Profile</div>
          <div className="text-slate-500 font-mono">{aiStatusText}</div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Clean Top Bar */}
        <header className="h-16 px-6 border-b border-slate-800 bg-[#0F172A]/60 flex items-center justify-between gap-8 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="p-2 -ml-2 text-slate-400 hover:text-slate-100 lg:hidden"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="font-display text-base font-semibold text-slate-100 whitespace-nowrap truncate">
              {activeTitle}
            </h1>
          </div>

          <button
            type="button"
            onClick={() => setImportModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-500 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Import Vacancy</span>
          </button>
        </header>

        <main className="flex-1 p-6 max-w-7xl w-full mx-auto">
          {activeTab === 'overview' && (
            <DashboardPage
              onNavigate={(tab) => setActiveTab(tab)}
              onOpenImport={() => setImportModalOpen(true)}
              refreshSignal={refreshSignal}
            />
          )}
          {activeTab === 'jobs' && (
            <JobsPage
              onOpenImport={() => setImportModalOpen(true)}
              onApplicationCreated={triggerRefresh}
              refreshSignal={refreshSignal}
            />
          )}
          {activeTab === 'approval' && (
            <ApprovalQueuePage onUpdated={triggerRefresh} refreshSignal={refreshSignal} />
          )}
          {activeTab === 'applications' && (
            <ApplicationsPage onUpdated={triggerRefresh} refreshSignal={refreshSignal} />
          )}
          {activeTab === 'cv' && (
            <CvManagerPage onUpdated={triggerRefresh} refreshSignal={refreshSignal} />
          )}
          {activeTab === 'settings' && <SettingsPage onUpdated={triggerRefresh} />}
        </main>
      </div>

      <ImportJobModal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onImported={() => {
          triggerRefresh();
          setActiveTab('jobs');
        }}
      />
    </div>
  );
}
