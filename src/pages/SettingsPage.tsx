import { CheckCircle2, Lock, Save, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../services/api';
import type { AiReadiness, CvProfile, UserSettings, WorkArrangement } from '../types';

interface SettingsPageProps {
  onUpdated: () => void;
}

const ARRANGEMENT_OPTIONS: WorkArrangement[] = ['On-site', 'Hybrid', 'Remote'];

export function SettingsPage({ onUpdated }: SettingsPageProps) {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [aiReadiness, setAiReadiness] = useState<AiReadiness | null>(null);
  const [cvs, setCvs] = useState<CvProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [locationsText, setLocationsText] = useState('');
  const [positionsText, setPositionsText] = useState('');

  useEffect(() => {
    Promise.all([api.getSettings(), api.getCvs()])
      .then(([setRes, cvRes]) => {
        setSettings(setRes.settings);
        setAiReadiness(setRes.aiReadiness);
        setCvs(cvRes.cvs);
        setLocationsText(setRes.settings.target_locations.join(', '));
        setPositionsText(setRes.settings.target_positions.join('\n'));
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load settings.');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading || !settings) {
    return <div className="p-6 text-xs text-slate-400">Loading configuration...</div>;
  }

  function toggleArrangement(arr: WorkArrangement) {
    if (!settings) return;
    const exists = settings.work_arrangements.includes(arr);
    const next = exists
      ? settings.work_arrangements.filter((a) => a !== arr)
      : [...settings.work_arrangements, arr];
    if (next.length === 0) return;
    setSettings({ ...settings, work_arrangements: next });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const target_locations = locationsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const target_positions = positionsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await api.updateSettings({
        ai_provider: settings.ai_provider,
        openai_model: settings.openai_model,
        min_salary_idr: settings.min_salary_idr,
        include_negotiable_salary: settings.include_negotiable_salary,
        target_locations,
        target_positions,
        work_arrangements: settings.work_arrangements,
        min_match_score: settings.min_match_score,
        preferred_cv_id: settings.preferred_cv_id,
        approval_mode: settings.approval_mode,
        baseline_profile: settings.baseline_profile,
      });

      setSettings(res.settings);
      setAiReadiness(res.aiReadiness);
      setNotice('Settings saved to SQLite database.');
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-4xl space-y-6">
      {error && (
        <div className="p-3 bg-rose-950/50 border border-rose-800/70 rounded-md text-xs text-rose-200">
          {error}
        </div>
      )}

      {notice && (
        <div className="p-3 bg-emerald-950/40 border border-emerald-800/60 rounded-md text-xs text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Backend AI Readiness (No API Key Inputs in Frontend) */}
      <section className="bg-[#111827] border border-slate-800 rounded-lg p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Backend AI Provider Configuration</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              API secrets are managed strictly via server environment variables (.env) and are never
              exposed to browser JavaScript.
            </p>
          </div>
          <Lock className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 bg-[#0B1120] border border-slate-800 rounded-md text-xs">
          <div>
            <div className="text-slate-500">Active Engine</div>
            <div className="mt-1 font-mono text-slate-200">
              {aiReadiness?.configured
                ? `${aiReadiness.activeProvider.toUpperCase()} (${aiReadiness.activeModel})`
                : 'Not configured'}
            </div>
          </div>
          <div>
            <div className="text-slate-500">OPENAI_API_KEY</div>
            <div
              className={`mt-1 font-medium ${
                aiReadiness?.openaiConfigured ? 'text-emerald-400' : 'text-slate-400'
              }`}
            >
              {aiReadiness?.openaiConfigured ? 'Detected in server env' : 'Not set in server env'}
            </div>
          </div>
          <div>
            <div className="text-slate-500">GEMINI_API_KEY</div>
            <div
              className={`mt-1 font-medium ${
                aiReadiness?.geminiConfigured ? 'text-emerald-400' : 'text-slate-400'
              }`}
            >
              {aiReadiness?.geminiConfigured ? 'Detected in server env' : 'Not set in server env'}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Provider Selection Strategy
            </label>
            <select
              value={settings.ai_provider}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  ai_provider: e.target.value as UserSettings['ai_provider'],
                })
              }
              className="w-full px-3 py-2 text-xs bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-sky-500"
            >
              <option value="auto">Auto (Prefer OpenAI, Fallback to Gemini)</option>
              <option value="openai">OpenAI API</option>
              <option value="gemini">Gemini API</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              OpenAI Model Name
            </label>
            <input
              type="text"
              value={settings.openai_model}
              onChange={(e) => setSettings({ ...settings, openai_model: e.target.value })}
              placeholder="gpt-4o-mini"
              className="w-full px-3 py-2 text-xs font-mono bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-sky-500"
            />
          </div>
        </div>
      </section>

      {/* Search Criteria & Matching Rules */}
      <section className="bg-[#111827] border border-slate-800 rounded-lg p-6 space-y-5">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">
            Jakarta Job Search & Matching Criteria
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Controls compatibility scoring thresholds and default matching targets.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Minimum Expected Salary (IDR / month)
            </label>
            <input
              type="number"
              min={0}
              step={500000}
              value={settings.min_salary_idr}
              onChange={(e) =>
                setSettings({ ...settings, min_salary_idr: Number(e.target.value) || 0 })
              }
              className="w-full px-3 py-2 text-xs font-mono bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Minimum AI Match Score Threshold (%)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={settings.min_match_score}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  min_match_score: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                })
              }
              className="w-full px-3 py-2 text-xs font-mono bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Target Locations (comma-separated)
            </label>
            <input
              type="text"
              value={locationsText}
              onChange={(e) => setLocationsText(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Preferred Primary CV
            </label>
            <select
              value={settings.preferred_cv_id ?? ''}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  preferred_cv_id: e.target.value ? Number(e.target.value) : null,
                })
              }
              className="w-full px-3 py-2 text-xs bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-sky-500"
            >
              <option value="">Default / Latest Uploaded CV</option>
              {cvs.map((cv) => (
                <option key={cv.id} value={cv.id}>
                  {cv.name} ({cv.original_filename})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <span className="block text-xs font-medium text-slate-300">Work Arrangements</span>
          <div className="flex flex-wrap gap-3">
            {ARRANGEMENT_OPTIONS.map((arr) => {
              const checked = settings.work_arrangements.includes(arr);
              return (
                <label
                  key={arr}
                  className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#0B1120] border border-slate-700 rounded-md text-xs text-slate-200 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleArrangement(arr)}
                    className="rounded border-slate-600 bg-[#111827] text-sky-500"
                  />
                  <span>{arr}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
          <label className="inline-flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.include_negotiable_salary}
              onChange={(e) =>
                setSettings({ ...settings, include_negotiable_salary: e.target.checked })
              }
              className="rounded border-slate-600 bg-[#0B1120] text-sky-500"
            />
            <span>Include negotiable and undisclosed salaries when vacancy is relevant</span>
          </label>

          <label className="inline-flex items-center gap-2.5 text-xs text-emerald-300 cursor-pointer font-medium">
            <input
              type="checkbox"
              checked={settings.approval_mode}
              onChange={(e) => setSettings({ ...settings, approval_mode: e.target.checked })}
              className="rounded border-slate-600 bg-[#0B1120] text-emerald-500"
            />
            <ShieldCheck className="w-4 h-4" />
            <span>Require Explicit Approval Mode</span>
          </label>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5">
            Target Job Positions (one per line)
          </label>
          <textarea
            rows={5}
            value={positionsText}
            onChange={(e) => setPositionsText(e.target.value)}
            className="w-full p-3 text-xs bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-sky-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5">
            Fallback Cybersecurity Profile (Used Only When No CV Is Uploaded)
          </label>
          <textarea
            rows={6}
            value={settings.baseline_profile}
            onChange={(e) => setSettings({ ...settings, baseline_profile: e.target.value })}
            className="w-full p-3 text-xs bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 leading-relaxed focus:outline-none focus:border-sky-500"
          />
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-md transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Saving Settings...' : 'Save Configuration'}</span>
          </button>
        </div>
      </section>
    </form>
  );
}
