import {
  CheckCircle2,
  ExternalLink,
  FilePlus2,
  Loader2,
  Pencil,
  Save,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ScoreDisplay, StatusText, formatDateShort } from '../components/StatusText';
import { api } from '../services/api';
import type { CvProfile, JobAnalysis, JobRecord, WorkArrangement } from '../types';

interface JobsPageProps {
  onOpenImport: () => void;
  onApplicationCreated: () => void;
  refreshSignal: number;
}

export function JobsPage({ onOpenImport, onApplicationCreated, refreshSignal }: JobsPageProps) {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [cvs, setCvs] = useState<CvProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [arrangement, setArrangement] = useState('ALL');
  const [minScore, setMinScore] = useState(0);

  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedJob, setSelectedJob] = useState<JobRecord | null>(null);
  const [latestAnalysis, setLatestAnalysis] = useState<JobAnalysis | null>(null);
  const [selectedCvId, setSelectedCvId] = useState<number | null>(null);

  const [analyzing, setAnalyzing] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [editingJob, setEditingJob] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editCompany, setEditCompany] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editArrangement, setEditArrangement] = useState<WorkArrangement>('Hybrid');
  const [editSalaryText, setEditSalaryText] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const [jobsRes, cvRes] = await Promise.all([
        api.getJobs({ search, arrangement, minScore }),
        api.getCvs(),
      ]);
      setJobs(jobsRes.jobs);
      setCvs(cvRes.cvs);

      const primary = cvRes.cvs.find((c) => c.is_primary) || cvRes.cvs[0] || null;
      setSelectedCvId((prev) => prev ?? (primary ? primary.id : null));

      if (jobsRes.jobs.length > 0 && !selectedJobId) {
        setSelectedJobId(jobsRes.jobs[0].id);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to load vacancies.');
    } finally {
      setLoading(false);
    }
  }, [search, arrangement, minScore, selectedJobId]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs, refreshSignal]);

  const loadJobDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    setActionError(null);
    try {
      const res = await api.getJobDetail(id);
      setSelectedJob(res.job);
      setLatestAnalysis(res.latestAnalysis);
      setEditingJob(false);
      setEditTitle(res.job.title);
      setEditCompany(res.job.company);
      setEditLocation(res.job.location);
      setEditArrangement(res.job.work_arrangement);
      setEditSalaryText(res.job.salary_text);
      setEditDescription(res.job.description);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to load vacancy detail.');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedJobId) {
      loadJobDetail(selectedJobId);
    } else {
      setSelectedJob(null);
      setLatestAnalysis(null);
    }
  }, [selectedJobId, loadJobDetail]);

  async function handleAnalyze() {
    if (!selectedJob) return;
    setAnalyzing(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const { analysis } = await api.analyzeJob(selectedJob.id, selectedCvId);
      setLatestAnalysis(analysis);
      setActionNotice(
        `AI compatibility analysis complete: ${analysis.suitability_score}% (${analysis.classification}).`
      );
      await loadJobs();
      await loadJobDetail(selectedJob.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'AI analysis failed.');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handlePrepareApplication() {
    if (!selectedJob) return;
    setPreparing(true);
    setActionError(null);
    setActionNotice(null);
    try {
      const res = await api.createApplication({
        job_id: selectedJob.id,
        cv_id: selectedCvId,
        generate_cover_letter: true,
      });
      setActionNotice(
        res.warning
          ? `Application queued in Approval Queue (Note: ${res.warning})`
          : 'Application drafted with AI cover letter and placed into Approval Queue.'
      );
      await loadJobs();
      await loadJobDetail(selectedJob.id);
      onApplicationCreated();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to prepare application.');
    } finally {
      setPreparing(false);
    }
  }

  async function handleDeleteJob(jobId: number) {
    setActionError(null);
    try {
      await api.deleteJob(jobId);
      if (selectedJobId === jobId) {
        setSelectedJobId(null);
      }
      await loadJobs();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete vacancy.');
    }
  }

  async function handleSaveJobEdit(e: FormEvent) {
    e.preventDefault();
    if (!selectedJob) return;
    setSavingEdit(true);
    setActionError(null);
    setActionNotice(null);
    try {
      await api.updateJob(selectedJob.id, {
        title: editTitle,
        company: editCompany,
        location: editLocation,
        work_arrangement: editArrangement,
        salary_text: editSalaryText,
        description: editDescription,
      });
      setEditingJob(false);
      setActionNotice('Vacancy details updated.');
      await loadJobs();
      await loadJobDetail(selectedJob.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update vacancy details.');
    } finally {
      setSavingEdit(false);
    }
  }

  const dimensions = latestAnalysis
    ? [
        { label: 'Technical Skills', data: latestAnalysis.technical_skills },
        { label: 'Work Experience', data: latestAnalysis.work_experience },
        { label: 'Education', data: latestAnalysis.education },
        { label: 'Certifications', data: latestAnalysis.certifications },
        { label: 'Seniority', data: latestAnalysis.seniority },
        { label: 'Location', data: latestAnalysis.location },
        { label: 'Salary Compatibility', data: latestAnalysis.salary },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Filter Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-[#111827] border border-slate-800 rounded-lg p-4">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search
              className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="text"
              placeholder="Search title, company, skills..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          <select
            value={arrangement}
            onChange={(e) => setArrangement(e.target.value)}
            aria-label="Filter by work arrangement"
            className="px-3 py-2 text-xs bg-[#0B1120] border border-slate-700 rounded-md text-slate-200 focus:outline-none focus:border-sky-500"
          >
            <option value="ALL">All Arrangements</option>
            <option value="On-site">On-site</option>
            <option value="Hybrid">Hybrid</option>
            <option value="Remote">Remote</option>
          </select>

          <select
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            aria-label="Filter by minimum AI match score"
            className="px-3 py-2 text-xs bg-[#0B1120] border border-slate-700 rounded-md text-slate-200 focus:outline-none focus:border-sky-500"
          >
            <option value={0}>Any Match Score</option>
            <option value={50}>50%+ (Moderate+)</option>
            <option value={70}>70%+ (Good+)</option>
            <option value={85}>85%+ (Excellent)</option>
          </select>
        </div>

        <button
          type="button"
          onClick={onOpenImport}
          className="px-4 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-500 rounded-md transition-colors whitespace-nowrap shrink-0"
        >
          Import Vacancy
        </button>
      </div>

      {/* Main Split Workspace: Vacancy Table + AI Job Analyzer */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-5 bg-[#111827] border border-slate-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-slate-200">
              Discovered Vacancies ({jobs.length})
            </h2>
          </div>

          {loading ? (
            <div className="p-6 text-xs text-slate-400">Loading vacancies...</div>
          ) : jobs.length === 0 ? (
            <div className="p-8 text-center space-y-3">
              <p className="text-sm text-slate-300 font-medium">No vacancies found</p>
              <p className="text-xs text-slate-500">
                Import a Glints vacancy URL and paste the job description to begin AI matching.
              </p>
              <button
                type="button"
                onClick={onOpenImport}
                className="px-4 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-500 rounded-md transition-colors"
              >
                Import Vacancy
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/80 max-h-[700px] overflow-y-auto">
              {jobs.map((job) => {
                const active = selectedJobId === job.id;
                return (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => setSelectedJobId(job.id)}
                    className={`w-full text-left px-4 py-3.5 transition-colors ${
                      active ? 'bg-slate-800/70' : 'hover:bg-slate-800/30'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-100 truncate">
                          {job.title}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5 truncate">
                          {job.company} · {job.location} · {job.work_arrangement}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <ScoreDisplay score={job.latest_score} />
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                      <StatusText status={job.application_status || job.status} />
                      <span className="font-mono text-slate-500 tabular-nums">
                        {job.salary_text}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Panel: Job Detail + 9-Dimension AI Job Analyzer */}
        <div className="xl:col-span-7 bg-[#111827] border border-slate-800 rounded-lg p-6">
          {!selectedJob ? (
            <div className="py-16 text-center text-xs text-slate-500">
              Select a vacancy from the list to inspect requirements and run AI compatibility
              analysis.
            </div>
          ) : detailLoading ? (
            <div className="py-16 text-center text-xs text-slate-400">Loading details...</div>
          ) : (
            <div className="space-y-6">
              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b border-slate-800">
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-semibold text-slate-100">{selectedJob.title}</h2>
                  </div>
                  <div className="text-xs text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-slate-200 font-medium">{selectedJob.company}</span>
                    <span aria-hidden="true">·</span>
                    <span>{selectedJob.location}</span>
                    <span aria-hidden="true">·</span>
                    <span>{selectedJob.work_arrangement}</span>
                    <span aria-hidden="true">·</span>
                    <span>{selectedJob.employment_type}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">{selectedJob.salary_text}</span>
                  </div>
                  <div className="pt-1 flex items-center gap-4 text-xs">
                    <StatusText status={selectedJob.application_status || selectedJob.status} />
                    <span className="text-slate-500 font-mono tabular-nums">
                      Added {formatDateShort(selectedJob.created_at)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setEditingJob((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 border border-slate-700 hover:border-slate-500 rounded-md transition-colors whitespace-nowrap"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>{editingJob ? 'Cancel Edit' : 'Edit Details'}</span>
                  </button>
                  <a
                    href={selectedJob.vacancy_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 border border-slate-700 hover:border-slate-500 rounded-md transition-colors whitespace-nowrap"
                  >
                    <span>Open Original Vacancy</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <button
                    type="button"
                    onClick={() => handleDeleteJob(selectedJob.id)}
                    className="p-2 text-slate-400 hover:text-rose-400 border border-slate-800 hover:border-rose-900 rounded-md transition-colors"
                    aria-label="Delete vacancy"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {editingJob && (
                <form
                  onSubmit={handleSaveJobEdit}
                  className="p-4 bg-[#0B1120] border border-slate-800 rounded-md space-y-3"
                >
                  <div className="text-xs font-semibold text-slate-200">Edit Vacancy Details</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Position Title</label>
                      <input
                        type="text"
                        required
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="w-full px-3 py-1.5 text-xs bg-[#111827] border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-sky-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Company Name</label>
                      <input
                        type="text"
                        required
                        value={editCompany}
                        onChange={(e) => setEditCompany(e.target.value)}
                        className="w-full px-3 py-1.5 text-xs bg-[#111827] border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-sky-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Location</label>
                      <input
                        type="text"
                        required
                        value={editLocation}
                        onChange={(e) => setEditLocation(e.target.value)}
                        className="w-full px-3 py-1.5 text-xs bg-[#111827] border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-sky-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Arrangement</label>
                      <select
                        value={editArrangement}
                        onChange={(e) => setEditArrangement(e.target.value as WorkArrangement)}
                        className="w-full px-3 py-1.5 text-xs bg-[#111827] border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-sky-500"
                      >
                        <option value="On-site">On-site</option>
                        <option value="Hybrid">Hybrid</option>
                        <option value="Remote">Remote</option>
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-slate-400 mb-1">Salary Text</label>
                      <input
                        type="text"
                        value={editSalaryText}
                        onChange={(e) => setEditSalaryText(e.target.value)}
                        className="w-full px-3 py-1.5 text-xs bg-[#111827] border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-sky-500"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-slate-400 mb-1">Job Description</label>
                      <textarea
                        rows={5}
                        required
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        className="w-full p-2.5 text-xs bg-[#111827] border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-sky-500"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={savingEdit}
                      className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-md transition-colors"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>{savingEdit ? 'Saving...' : 'Save Changes'}</span>
                    </button>
                  </div>
                </form>
              )}

              {actionError && (
                <div className="p-3 bg-rose-950/50 border border-rose-800/70 rounded-md text-xs text-rose-200">
                  {actionError}
                </div>
              )}

              {actionNotice && (
                <div className="p-3 bg-emerald-950/40 border border-emerald-800/60 rounded-md text-xs text-emerald-200 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{actionNotice}</span>
                </div>
              )}

              {/* AI Control Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-[#0B1120] border border-slate-800 rounded-md">
                <div className="flex items-center gap-3 min-w-0">
                  <label className="text-xs text-slate-400 shrink-0">Match Against:</label>
                  <select
                    value={selectedCvId ?? ''}
                    onChange={(e) =>
                      setSelectedCvId(e.target.value ? Number(e.target.value) : null)
                    }
                    className="px-3 py-1.5 text-xs bg-[#111827] border border-slate-700 rounded-md text-slate-200 focus:outline-none focus:border-sky-500 max-w-xs truncate"
                  >
                    <option value="">
                      {cvs.length === 0
                        ? 'Baseline Cybersecurity Profile'
                        : 'Use Primary / Default Profile'}
                    </option>
                    {cvs.map((cv) => (
                      <option key={cv.id} value={cv.id}>
                        {cv.name} {cv.is_primary ? '(Primary)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={handleAnalyze}
                    disabled={analyzing}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
                  >
                    {analyzing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    <span>{analyzing ? 'Analyzing...' : latestAnalysis ? 'Re-Run AI Analysis' : 'Run AI Analysis'}</span>
                  </button>

                  {selectedJob.application_id ? (
                    <span className="text-xs text-emerald-400 font-medium px-2">
                      Application #{selectedJob.application_id} Created
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={handlePrepareApplication}
                      disabled={preparing}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-100 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 border border-slate-700 rounded-md transition-colors whitespace-nowrap"
                    >
                      {preparing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <FilePlus2 className="w-3.5 h-3.5" />
                      )}
                      <span>{preparing ? 'Drafting...' : 'Prepare Application'}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Analysis Output */}
              {latestAnalysis ? (
                <div className="space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
                    <div>
                      <div className="text-xs font-medium text-slate-400">Overall Suitability Score</div>
                      <div className="mt-1">
                        <ScoreDisplay
                          score={latestAnalysis.suitability_score}
                          classification={latestAnalysis.classification}
                        />
                      </div>
                    </div>
                    <div className="text-xs text-slate-500 font-mono">
                      Model: {latestAnalysis.model_used}
                    </div>
                  </div>

                  <p className="text-sm text-slate-300 leading-relaxed">
                    {latestAnalysis.overall_explanation}
                  </p>

                  {/* 7 Quantitative Dimensions */}
                  <div className="divide-y divide-slate-800/70 border border-slate-800 rounded-md">
                    {dimensions.map((dim) => (
                      <div key={dim.label} className="p-3.5 space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-slate-200">{dim.label}</span>
                          <span className="font-mono tabular-nums text-sky-400 font-semibold">
                            {dim.data.score}/100
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed">{dim.data.summary}</p>
                      </div>
                    ))}
                  </div>

                  {/* Responsibilities + Skill Gaps + Strengths */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 bg-[#0B1120] border border-slate-800 rounded-md space-y-2">
                      <h3 className="text-xs font-semibold text-emerald-400">
                        Verified Strengths
                      </h3>
                      {latestAnalysis.strengths.length === 0 ? (
                        <p className="text-xs text-slate-500">None highlighted.</p>
                      ) : (
                        <ul className="space-y-1.5 text-xs text-slate-300 list-disc pl-4">
                          {latestAnalysis.strengths.map((s, idx) => (
                            <li key={idx}>{s}</li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="p-4 bg-[#0B1120] border border-slate-800 rounded-md space-y-2">
                      <h3 className="text-xs font-semibold text-amber-400">
                        Potential Skill & Requirement Gaps
                      </h3>
                      {latestAnalysis.skill_gaps.length === 0 ? (
                        <p className="text-xs text-slate-500">No major gaps identified.</p>
                      ) : (
                        <ul className="space-y-1.5 text-xs text-slate-300 list-disc pl-4">
                          {latestAnalysis.skill_gaps.map((g, idx) => (
                            <li key={idx}>{g}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>

                  <div className="p-4 bg-[#0B1120] border border-slate-800 rounded-md space-y-1.5">
                    <h3 className="text-xs font-semibold text-slate-200">
                      Core Job Responsibilities Summary
                    </h3>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      {latestAnalysis.responsibilities_summary}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-6 bg-[#0B1120] border border-slate-800 rounded-md text-xs text-slate-400">
                  This vacancy has not been analyzed yet. Click <strong className="text-slate-200">Run AI Analysis</strong> above to evaluate all nine compatibility dimensions against your CV.
                </div>
              )}

              {/* Raw Job Description */}
              <div className="pt-4 border-t border-slate-800 space-y-2">
                <h3 className="text-xs font-semibold text-slate-300">Full Job Description</h3>
                <pre className="whitespace-pre-wrap font-sans text-xs text-slate-400 leading-relaxed max-h-64 overflow-y-auto p-3.5 bg-[#0B1120] border border-slate-800 rounded-md">
                  {selectedJob.description}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
