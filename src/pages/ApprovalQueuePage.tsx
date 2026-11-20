import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ScoreDisplay, StatusText, formatDateShort } from '../components/StatusText';
import { api } from '../services/api';
import type {
  ApplicationHistoryRecord,
  ApplicationRecord,
  CvProfile,
  JobAnalysis,
  JobRecord,
} from '../types';

interface ApprovalQueuePageProps {
  onUpdated: () => void;
  refreshSignal: number;
}

export function ApprovalQueuePage({ onUpdated, refreshSignal }: ApprovalQueuePageProps) {
  const [queueFilter, setQueueFilter] = useState<'PENDING_APPROVAL' | 'APPROVED' | 'ALL'>(
    'PENDING_APPROVAL'
  );
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [cvs, setCvs] = useState<CvProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{
    application: ApplicationRecord;
    job: JobRecord;
    analysis: JobAnalysis | null;
    history: ApplicationHistoryRecord[];
  } | null>(null);

  const [coverLetterDraft, setCoverLetterDraft] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [copied, setCopied] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const [appRes, cvRes] = await Promise.all([
        api.getApplications({ status: queueFilter }),
        api.getCvs(),
      ]);
      setApplications(appRes.applications);
      setCvs(cvRes.cvs);

      if (appRes.applications.length > 0) {
        const stillExists = appRes.applications.some((a) => a.id === selectedId);
        if (!stillExists) {
          setSelectedId(appRes.applications[0].id);
        }
      } else {
        setSelectedId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load approval queue.');
    } finally {
      setLoading(false);
    }
  }, [queueFilter, selectedId]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue, refreshSignal]);

  const loadDetail = useCallback(async (appId: number) => {
    setError(null);
    try {
      const res = await api.getApplicationDetail(appId);
      setDetail({
        application: res.application,
        job: res.job,
        analysis: res.analysis,
        history: res.history,
      });
      setCoverLetterDraft(res.application.cover_letter || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load application details.');
    }
  }, []);

  useEffect(() => {
    if (selectedId) {
      loadDetail(selectedId);
    } else {
      setDetail(null);
      setCoverLetterDraft('');
    }
  }, [selectedId, loadDetail]);

  async function handleChangeCv(cvId: number) {
    if (!detail) return;
    setBusyAction('cv');
    setError(null);
    setNotice(null);
    try {
      await api.changeApplicationCv(detail.application.id, cvId);
      setNotice('Selected CV updated for this application.');
      await loadDetail(detail.application.id);
      await loadQueue();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change CV.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRegenerateCoverLetter() {
    if (!detail) return;
    setBusyAction('regenerate');
    setError(null);
    setNotice(null);
    try {
      const res = await api.generateCoverLetter(detail.application.id, {
        cv_id: detail.application.cv_id,
      });
      setCoverLetterDraft(res.cover_letter);
      setNotice(`Cover letter generated using ${res.model_used}.`);
      await loadDetail(detail.application.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate cover letter.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSaveCoverLetter() {
    if (!detail) return;
    setBusyAction('save');
    setError(null);
    setNotice(null);
    try {
      await api.saveCoverLetter(detail.application.id, coverLetterDraft);
      setNotice('Cover letter edits saved.');
      await loadDetail(detail.application.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save cover letter.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCopyCoverLetter() {
    if (!coverLetterDraft) return;
    await navigator.clipboard.writeText(coverLetterDraft);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function handleApprove() {
    if (!detail) return;
    setBusyAction('approve');
    setError(null);
    setNotice(null);
    try {
      await api.approveApplication(detail.application.id, reviewNote.trim() || undefined);
      setReviewNote('');
      setNotice(
        'Application explicitly approved. Open the original Glints vacancy to complete your authorized submission, then mark it Submitted in Application Tracker.'
      );
      await loadQueue();
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve application.');
    } finally {
      setBusyAction(null);
    }
  }

  async function handleReject() {
    if (!detail) return;
    setBusyAction('reject');
    setError(null);
    setNotice(null);
    try {
      await api.rejectApplication(detail.application.id, reviewNote.trim() || undefined);
      setReviewNote('');
      setNotice('Application rejected and logged in history.');
      await loadQueue();
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject application.');
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Compliance & Queue Filter Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#111827] border border-slate-800 rounded-lg p-4">
        <div className="flex items-center gap-2.5 text-xs text-slate-300">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
          <span>
            Approval Mode Enforced: Every prepared application requires your explicit review before
            authorized Glints submission.
          </span>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#0B1120] border border-slate-800 rounded-md shrink-0">
          {(
            [
              { id: 'PENDING_APPROVAL', label: 'Pending Approval' },
              { id: 'APPROVED', label: 'Approved Ready' },
              { id: 'ALL', label: 'All Prepared' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setQueueFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                queueFilter === tab.id
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Queue List */}
        <div className="xl:col-span-4 bg-[#111827] border border-slate-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800">
            <h2 className="text-xs font-semibold text-slate-200">
              Review Queue ({applications.length})
            </h2>
          </div>

          {loading ? (
            <div className="p-6 text-xs text-slate-400">Loading queue...</div>
          ) : applications.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <p className="text-sm font-medium text-slate-300">Queue is clear</p>
              <p className="text-xs text-slate-500">
                Prepare an application from Job Discovery to review its cover letter and suitability
                score here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/80 max-h-[680px] overflow-y-auto">
              {applications.map((app) => {
                const active = selectedId === app.id;
                return (
                  <button
                    key={app.id}
                    type="button"
                    onClick={() => setSelectedId(app.id)}
                    className={`w-full text-left px-4 py-3.5 transition-colors ${
                      active ? 'bg-slate-800/70' : 'hover:bg-slate-800/30'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-100 truncate">
                          {app.job_title}
                        </div>
                        <div className="text-xs text-slate-400 truncate mt-0.5">
                          {app.company} · {app.location}
                        </div>
                      </div>
                      <ScoreDisplay score={app.match_score} />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <StatusText status={app.status} />
                      <span className="font-mono text-slate-500 tabular-nums">
                        {formatDateShort(app.updated_at)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Review Workbench */}
        <div className="xl:col-span-8 bg-[#111827] border border-slate-800 rounded-lg p-6">
          {!detail ? (
            <div className="py-16 text-center text-xs text-slate-500">
              Select an application in the queue to review its CV, cover letter, and approval status.
            </div>
          ) : (
            <div className="space-y-6">
              {/* Application Header */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b border-slate-800">
                <div className="space-y-1.5">
                  <h2 className="text-lg font-semibold text-slate-100">{detail.job.title}</h2>
                  <div className="text-xs text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-slate-200 font-medium">{detail.job.company}</span>
                    <span aria-hidden="true">·</span>
                    <span>{detail.job.location}</span>
                    <span aria-hidden="true">·</span>
                    <span>{detail.job.work_arrangement}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">{detail.job.salary_text}</span>
                  </div>
                  <div className="pt-1 flex flex-wrap items-center gap-4">
                    <StatusText status={detail.application.status} />
                    <ScoreDisplay
                      score={detail.application.match_score}
                      classification={detail.analysis?.classification}
                    />
                  </div>
                </div>

                <a
                  href={detail.job.vacancy_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-200 border border-slate-700 hover:border-slate-500 rounded-md transition-colors whitespace-nowrap shrink-0"
                >
                  <span>Open Original Vacancy</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
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

              {/* Action 3: Change CV */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-[#0B1120] border border-slate-800 rounded-md">
                <div>
                  <div className="text-xs font-medium text-slate-200">Selected CV Version</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {detail.application.cv_name || 'Baseline Profile (Upload a CV in CV Manager)'}
                  </div>
                </div>
                <select
                  value={detail.application.cv_id ?? ''}
                  disabled={busyAction === 'cv' || cvs.length === 0}
                  onChange={(e) => {
                    if (e.target.value) handleChangeCv(Number(e.target.value));
                  }}
                  aria-label="Change CV for this application"
                  className="px-3 py-2 text-xs bg-[#111827] border border-slate-700 rounded-md text-slate-200 focus:outline-none focus:border-sky-500"
                >
                  <option value="" disabled>
                    {cvs.length === 0 ? 'No CV uploaded yet' : 'Select CV version'}
                  </option>
                  {cvs.map((cv) => (
                    <option key={cv.id} value={cv.id}>
                      {cv.name} ({cv.original_filename})
                    </option>
                  ))}
                </select>
              </div>

              {/* Action 2: Edit, Regenerate, Copy, Save Cover Letter */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-slate-200">
                    Customized Cover Letter
                  </h3>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleRegenerateCoverLetter}
                      disabled={busyAction === 'regenerate'}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
                    >
                      {busyAction === 'regenerate' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      <span>{busyAction === 'regenerate' ? 'Generating...' : 'Regenerate AI Draft'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleCopyCoverLetter}
                      disabled={!coverLetterDraft}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 border border-slate-700 hover:border-slate-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
                    >
                      {copied ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copied ? 'Copied' : 'Copy'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleSaveCoverLetter}
                      disabled={busyAction === 'save' || !coverLetterDraft.trim()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>{busyAction === 'save' ? 'Saving...' : 'Save Edit'}</span>
                    </button>
                  </div>
                </div>

                <textarea
                  rows={11}
                  value={coverLetterDraft}
                  onChange={(e) => setCoverLetterDraft(e.target.value)}
                  placeholder="Click 'Regenerate AI Draft' to write a cover letter grounded in your CV..."
                  className="w-full p-4 text-sm bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 leading-relaxed focus:outline-none focus:border-sky-500"
                />
              </div>

              {/* Actions 4 & 5: Explicit Approve / Reject */}
              <div className="pt-4 border-t border-slate-800 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Approval / Rejection Note (Recorded in Audit History)
                  </label>
                  <input
                    type="text"
                    placeholder="Optional note or rejection reason..."
                    value={reviewNote}
                    onChange={(e) => setReviewNote(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={handleReject}
                    disabled={busyAction !== null}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-rose-200 bg-rose-950/60 hover:bg-rose-900/70 border border-rose-800/80 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
                  >
                    <XCircle className="w-4 h-4" />
                    <span>Reject Application</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleApprove}
                    disabled={busyAction !== null}
                    className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Approve Application</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
