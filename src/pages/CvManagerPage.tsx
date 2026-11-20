import { CheckCircle2, FileText, Loader2, Sparkles, Star, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { formatDateShort } from '../components/StatusText';
import { api } from '../services/api';
import type { CvProfile } from '../types';

interface CvManagerPageProps {
  onUpdated: () => void;
  refreshSignal: number;
}

export function CvManagerPage({ onUpdated, refreshSignal }: CvManagerPageProps) {
  const [cvs, setCvs] = useState<CvProfile[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const [cvName, setCvName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [setAsPrimary, setSetAsPrimary] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<number | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadCvs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getCvs();
      setCvs(res.cvs);
      if (res.cvs.length > 0) {
        setSelectedId((prev) =>
          prev && res.cvs.some((c) => c.id === prev) ? prev : res.cvs[0].id
        );
      } else {
        setSelectedId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load CV versions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCvs();
  }, [loadCvs, refreshSignal]);

  const selectedCv = cvs.find((c) => c.id === selectedId) || null;

  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    if (!selectedFile) {
      setError('Please select a PDF or DOCX CV file.');
      return;
    }

    setUploading(true);
    setError(null);
    setNotice(null);

    try {
      const { cv } = await api.uploadCv(selectedFile, cvName.trim() || undefined, setAsPrimary);
      setCvName('');
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setSelectedId(cv.id);
      setNotice(`CV "${cv.name}" uploaded and text extracted (${cv.extracted_text.length} chars).`);
      await loadCvs();
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload CV.');
    } finally {
      setUploading(false);
    }
  }

  async function handleSetPrimary(id: number) {
    setError(null);
    setNotice(null);
    try {
      await api.setPrimaryCv(id);
      setNotice('Primary CV updated. All new AI analyses will prioritize this CV.');
      await loadCvs();
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set primary CV.');
    }
  }

  async function handleGenerateRecommendations(id: number) {
    setAnalyzingId(id);
    setError(null);
    setNotice(null);
    try {
      const res = await api.generateCvRecommendations(id);
      setNotice(`Factual CV review generated using ${res.modelUsed}.`);
      await loadCvs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate CV recommendations.');
    } finally {
      setAnalyzingId(null);
    }
  }

  async function handleDelete(id: number) {
    setError(null);
    setNotice(null);
    try {
      await api.deleteCv(id);
      await loadCvs();
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete CV.');
    }
  }

  return (
    <div className="space-y-6">
      {/* Upload Form */}
      <form
        onSubmit={handleUpload}
        className="bg-[#111827] border border-slate-800 rounded-lg p-6 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Upload New CV Version</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Supports PDF and DOCX up to 10 MB. Uploaded CVs replace the baseline profile as the
              primary AI matching source.
            </p>
          </div>
        </div>

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

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className="md:col-span-4">
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Version Label
            </label>
            <input
              type="text"
              placeholder="e.g. Cybersecurity Engineer v2026"
              value={cvName}
              onChange={(e) => setCvName(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="md:col-span-5">
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              CV File (.pdf or .docx)
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              className="w-full text-xs text-slate-300 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border file:border-slate-700 file:text-xs file:font-medium file:bg-[#0B1120] file:text-slate-200 hover:file:border-slate-500"
            />
          </div>

          <div className="md:col-span-3 flex items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={setAsPrimary}
                onChange={(e) => setSetAsPrimary(e.target.checked)}
                className="rounded border-slate-700 bg-[#0B1120] text-sky-500"
              />
              <span>Set Primary</span>
            </label>

            <button
              type="submit"
              disabled={uploading || !selectedFile}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
            >
              {uploading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              <span>{uploading ? 'Extracting...' : 'Upload CV'}</span>
            </button>
          </div>
        </div>
      </form>

      {/* CV Versions + Text Preview + Recommendations */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-4 bg-[#111827] border border-slate-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800">
            <h2 className="text-xs font-semibold text-slate-200">
              Saved CV Versions ({cvs.length})
            </h2>
          </div>

          {loading ? (
            <div className="p-6 text-xs text-slate-400">Loading CVs...</div>
          ) : cvs.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No CV uploaded yet. Until you upload a CV, AI matching uses your default Jakarta
              cybersecurity profile.
            </div>
          ) : (
            <div className="divide-y divide-slate-800/80">
              {cvs.map((cv) => {
                const active = selectedId === cv.id;
                return (
                  <div
                    key={cv.id}
                    onClick={() => setSelectedId(cv.id)}
                    className={`p-4 cursor-pointer transition-colors ${
                      active ? 'bg-slate-800/70' : 'hover:bg-slate-800/30'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <FileText className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                          <span className="text-sm font-medium text-slate-100 truncate">
                            {cv.name}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mt-1 truncate">
                          {cv.original_filename} · {Math.round(cv.file_size / 1024)} KB
                        </div>
                      </div>
                      {cv.is_primary && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 shrink-0">
                          <Star className="w-3.5 h-3.5 fill-emerald-400" />
                          <span>Primary</span>
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-slate-500 font-mono tabular-nums">
                      <span>Uploaded {formatDateShort(cv.created_at)}</span>
                      <span>{cv.extracted_text.length} chars</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="xl:col-span-8 bg-[#111827] border border-slate-800 rounded-lg p-6">
          {!selectedCv ? (
            <div className="py-16 text-center text-xs text-slate-500">
              Select a CV version to inspect extracted text and request factual AI improvements.
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
                <div>
                  <h3 className="text-base font-semibold text-slate-100">{selectedCv.name}</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {selectedCv.original_filename} ·{' '}
                    {selectedCv.is_primary ? 'Active Primary Matching CV' : 'Archived Version'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {!selectedCv.is_primary && (
                    <button
                      type="button"
                      onClick={() => handleSetPrimary(selectedCv.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-300 border border-emerald-800/70 hover:bg-emerald-950/50 rounded-md transition-colors whitespace-nowrap"
                    >
                      <Star className="w-3.5 h-3.5" />
                      <span>Set as Primary CV</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleGenerateRecommendations(selectedCv.id)}
                    disabled={analyzingId === selectedCv.id}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
                  >
                    {analyzingId === selectedCv.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {analyzingId === selectedCv.id
                        ? 'Analyzing CV...'
                        : 'AI Improvement Recommendations'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDelete(selectedCv.id)}
                    className="p-1.5 text-slate-400 hover:text-rose-400 border border-slate-800 hover:border-rose-900 rounded-md transition-colors"
                    aria-label="Delete CV"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {selectedCv.ai_recommendations && (
                <div className="p-4 bg-[#0B1120] border border-slate-800 rounded-md space-y-2">
                  <h4 className="text-xs font-semibold text-sky-400">
                    AI CV Improvement Recommendations (Factual Grounding Enforced)
                  </h4>
                  <pre className="whitespace-pre-wrap font-sans text-xs text-slate-300 leading-relaxed">
                    {selectedCv.ai_recommendations}
                  </pre>
                </div>
              )}

              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-slate-300">Extracted CV Text Preview</h4>
                <pre className="whitespace-pre-wrap font-mono text-xs text-slate-300 leading-relaxed max-h-96 overflow-y-auto p-4 bg-[#0B1120] border border-slate-800 rounded-md">
                  {selectedCv.extracted_text}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
