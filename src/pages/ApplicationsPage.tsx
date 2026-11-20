import { Calendar, ExternalLink, History, Save, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ScoreDisplay, StatusText, formatDateShort } from '../components/StatusText';
import { api } from '../services/api';
import type {
  ApplicationHistoryRecord,
  ApplicationRecord,
  ApplicationStatus,
} from '../types';

const ALL_STATUSES: ApplicationStatus[] = [
  'DISCOVERED',
  'ANALYZED',
  'PREPARED',
  'PENDING_APPROVAL',
  'APPROVED',
  'SUBMITTED',
  'INTERVIEW',
  'REJECTED',
  'WITHDRAWN',
];

interface ApplicationsPageProps {
  onUpdated: () => void;
  refreshSignal: number;
}

export function ApplicationsPage({ onUpdated, refreshSignal }: ApplicationsPageProps) {
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [history, setHistory] = useState<ApplicationHistoryRecord[]>([]);
  const [editStatus, setEditStatus] = useState<ApplicationStatus>('PENDING_APPROVAL');
  const [editNotes, setEditNotes] = useState('');
  const [editFollowUp, setEditFollowUp] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadApplications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getApplications({ status: statusFilter, search });
      setApplications(res.applications);
      if (res.applications.length > 0 && !selectedId) {
        setSelectedId(res.applications[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load applications.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search, selectedId]);

  useEffect(() => {
    loadApplications();
  }, [loadApplications, refreshSignal]);

  const loadDetail = useCallback(async (id: number) => {
    setError(null);
    try {
      const res = await api.getApplicationDetail(id);
      setEditStatus(res.application.status);
      setEditNotes(res.application.notes || '');
      setEditFollowUp(
        res.application.follow_up_date ? res.application.follow_up_date.slice(0, 10) : ''
      );
      setHistory(res.history);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load application detail.');
    }
  }, []);

  useEffect(() => {
    if (selectedId) {
      loadDetail(selectedId);
    } else {
      setHistory([]);
    }
  }, [selectedId, loadDetail]);

  const selectedApp = applications.find((a) => a.id === selectedId) || null;

  async function handleSaveTracking() {
    if (!selectedApp) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api.updateApplicationStatus(selectedApp.id, {
        status: editStatus,
        notes: editNotes,
        follow_up_date: editFollowUp ? editFollowUp : null,
      });
      setNotice('Application tracking updated.');
      await loadApplications();
      await loadDetail(selectedApp.id);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update application.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Filter Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-[#111827] border border-slate-800 rounded-lg p-4">
        <div className="relative flex-1 max-w-sm">
          <Search
            className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2"
            aria-hidden="true"
          />
          <input
            type="text"
            placeholder="Search company, role, location..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter applications by status"
          className="px-3 py-2 text-xs bg-[#0B1120] border border-slate-700 rounded-md text-slate-200 focus:outline-none focus:border-sky-500"
        >
          <option value="ALL">All Statuses</option>
          {ALL_STATUSES.map((st) => (
            <option key={st} value={st}>
              {st.replace('_', ' ')}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Table */}
        <div className="xl:col-span-7 bg-[#111827] border border-slate-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800">
            <h2 className="text-xs font-semibold text-slate-200">
              Tracked Applications ({applications.length})
            </h2>
          </div>

          {loading ? (
            <div className="p-6 text-xs text-slate-400">Loading tracker...</div>
          ) : applications.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500">
              No application records match the current filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-xs font-medium text-slate-400">
                    <th className="py-3 px-4">Position & Company</th>
                    <th className="py-3 px-3">Salary</th>
                    <th className="py-3 px-3 text-right">Match</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-4 text-right">Follow-Up</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 text-xs">
                  {applications.map((app) => {
                    const active = selectedId === app.id;
                    return (
                      <tr
                        key={app.id}
                        onClick={() => setSelectedId(app.id)}
                        className={`cursor-pointer transition-colors ${
                          active ? 'bg-slate-800/70' : 'hover:bg-slate-800/30'
                        }`}
                      >
                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-100">{app.job_title}</div>
                          <div className="text-slate-400 mt-0.5">{app.company}</div>
                        </td>
                        <td className="py-3 px-3 font-mono text-slate-300 tabular-nums whitespace-nowrap">
                          {app.salary_text}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <ScoreDisplay score={app.match_score} />
                        </td>
                        <td className="py-3 px-3">
                          <StatusText status={app.status} />
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-slate-400 tabular-nums whitespace-nowrap">
                          {formatDateShort(app.follow_up_date)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Detail & Audit Inspector */}
        <div className="xl:col-span-5 bg-[#111827] border border-slate-800 rounded-lg p-6">
          {!selectedApp ? (
            <div className="py-12 text-center text-xs text-slate-500">
              Select an application row to update status, notes, or follow-up reminders.
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-800">
                <div>
                  <h3 className="text-base font-semibold text-slate-100">
                    {selectedApp.job_title}
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {selectedApp.company} · {selectedApp.location}
                  </p>
                  <div className="mt-2 flex items-center gap-3 text-xs font-mono text-slate-500 tabular-nums">
                    <span>Created {formatDateShort(selectedApp.created_at)}</span>
                    {selectedApp.submitted_at && (
                      <span>· Submitted {formatDateShort(selectedApp.submitted_at)}</span>
                    )}
                  </div>
                </div>
                {selectedApp.vacancy_url && (
                  <a
                    href={selectedApp.vacancy_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-300 border border-slate-700 hover:border-slate-500 rounded-md whitespace-nowrap"
                  >
                    <span>Vacancy</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>

              {error && (
                <div className="p-3 bg-rose-950/50 border border-rose-800/70 rounded-md text-xs text-rose-200">
                  {error}
                </div>
              )}

              {notice && (
                <div className="p-3 bg-emerald-950/40 border border-emerald-800/60 rounded-md text-xs text-emerald-200">
                  {notice}
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Application Status
                  </label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as ApplicationStatus)}
                    className="w-full px-3 py-2 text-xs bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-sky-500"
                  >
                    {ALL_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Follow-Up Reminder Date
                  </label>
                  <div className="relative">
                    <Calendar
                      className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      type="date"
                      value={editFollowUp}
                      onChange={(e) => setEditFollowUp(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs font-mono bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-sky-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Notes & Interview Context
                  </label>
                  <textarea
                    rows={4}
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Recruiter name, interview stage, compensation discussion..."
                    className="w-full p-3 text-xs bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleSaveTracking}
                  disabled={saving}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-md transition-colors"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{saving ? 'Saving...' : 'Save Tracking Details'}</span>
                </button>
              </div>

              {/* Application History */}
              <div className="pt-4 border-t border-slate-800 space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                  <History className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                  <span>Status & Audit History</span>
                </div>

                {history.length === 0 ? (
                  <p className="text-xs text-slate-500">No history events recorded.</p>
                ) : (
                  <div className="divide-y divide-slate-800/70 max-h-56 overflow-y-auto">
                    {history.map((item) => (
                      <div key={item.id} className="py-2.5 text-xs space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-slate-200">{item.action}</span>
                          <span className="font-mono text-slate-500 tabular-nums">
                            {formatDateShort(item.created_at)}
                          </span>
                        </div>
                        {item.note && <p className="text-slate-400">{item.note}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
