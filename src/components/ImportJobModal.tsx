import { FileUp, Globe, Loader2, ShieldCheck, Trash2, Upload, X } from 'lucide-react';
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { api } from '../services/api';
import type { JobRecord, WorkArrangement } from '../types';

interface ImportJobModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImported: (job?: JobRecord) => void;
}

interface ParsedBatchItem {
  id: string;
  vacancy_url: string;
  title?: string;
  company?: string;
  location?: string;
  work_arrangement?: WorkArrangement;
  employment_type?: string;
  experience_level?: string;
  salary_text?: string;
  description?: string;
  validUrl: boolean;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && next === '\n') i++;
      row.push(cell.trim());
      if (row.some((c) => c.length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some((c) => c.length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

function normalizeArrangement(val: string | undefined): WorkArrangement | undefined {
  if (!val) return undefined;
  const lower = val.trim().toLowerCase();
  if (lower.includes('remote')) return 'Remote';
  if (lower.includes('hybrid')) return 'Hybrid';
  if (lower.includes('on-site') || lower.includes('onsite') || lower.includes('on site')) {
    return 'On-site';
  }
  return undefined;
}

function parseBatchFileContent(filename: string, rawText: string): ParsedBatchItem[] {
  const lowerName = filename.toLowerCase();
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  // 1. JSON format: array of strings or objects
  if (lowerName.endsWith('.json') || trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { urls?: unknown }).urls)
          ? (parsed as { urls: unknown[] }).urls
          : parsed && typeof parsed === 'object' && Array.isArray((parsed as { jobs?: unknown }).jobs)
            ? (parsed as { jobs: unknown[] }).jobs
            : [];

      return list
        .map((entry, idx): ParsedBatchItem | null => {
          if (typeof entry === 'string') {
            const url = entry.trim();
            return url
              ? { id: `json-${idx}`, vacancy_url: url, validUrl: isValidHttpUrl(url) }
              : null;
          }
          if (entry && typeof entry === 'object') {
            const obj = entry as Record<string, unknown>;
            const url = String(obj.vacancy_url || obj.url || obj.link || '').trim();
            if (!url) return null;
            return {
              id: `json-${idx}`,
              vacancy_url: url,
              title: obj.title ? String(obj.title).trim() : undefined,
              company: obj.company ? String(obj.company).trim() : undefined,
              location: obj.location ? String(obj.location).trim() : undefined,
              work_arrangement: normalizeArrangement(
                obj.work_arrangement ? String(obj.work_arrangement) : undefined
              ),
              employment_type: obj.employment_type ? String(obj.employment_type).trim() : undefined,
              experience_level: obj.experience_level
                ? String(obj.experience_level).trim()
                : undefined,
              salary_text: obj.salary_text ? String(obj.salary_text).trim() : undefined,
              description: obj.description ? String(obj.description).trim() : undefined,
              validUrl: isValidHttpUrl(url),
            };
          }
          return null;
        })
        .filter((x): x is ParsedBatchItem => x !== null);
    } catch {
      // Fall through to line/CSV parsing if malformed JSON
    }
  }

  // 2. CSV format (header-aware or single-column URLs)
  if (lowerName.endsWith('.csv')) {
    const rows = parseCsvRows(trimmed);
    if (rows.length === 0) return [];

    const firstRowLower = rows[0].map((c) => c.toLowerCase().replace(/[^a-z0-9_]/g, ''));
    const hasHeader = firstRowLower.some((h) =>
      ['url', 'vacancyurl', 'link', 'joburl', 'title', 'company'].includes(h)
    );

    if (hasHeader) {
      const idxUrl = firstRowLower.findIndex((h) =>
        ['vacancyurl', 'url', 'link', 'joburl'].includes(h)
      );
      const idxTitle = firstRowLower.findIndex((h) => ['title', 'position', 'jobtitle'].includes(h));
      const idxCompany = firstRowLower.findIndex((h) => ['company', 'companyname'].includes(h));
      const idxLocation = firstRowLower.findIndex((h) => ['location', 'city'].includes(h));
      const idxArr = firstRowLower.findIndex((h) =>
        ['workarrangement', 'arrangement', 'worktype'].includes(h)
      );
      const idxEmp = firstRowLower.findIndex((h) => ['employmenttype', 'type'].includes(h));
      const idxExp = firstRowLower.findIndex((h) => ['experiencelevel', 'experience'].includes(h));
      const idxSalary = firstRowLower.findIndex((h) => ['salarytext', 'salary'].includes(h));
      const idxDesc = firstRowLower.findIndex((h) =>
        ['description', 'jobdescription', 'details'].includes(h)
      );

      const results: ParsedBatchItem[] = [];
      for (let r = 1; r < rows.length; r++) {
        const cols = rows[r];
        const rawUrl = (idxUrl >= 0 ? cols[idxUrl] : cols[0] || '').trim();
        if (!rawUrl || rawUrl.startsWith('#')) continue;
        results.push({
          id: `csv-${r}`,
          vacancy_url: rawUrl,
          title: idxTitle >= 0 && cols[idxTitle] ? cols[idxTitle] : undefined,
          company: idxCompany >= 0 && cols[idxCompany] ? cols[idxCompany] : undefined,
          location: idxLocation >= 0 && cols[idxLocation] ? cols[idxLocation] : undefined,
          work_arrangement: idxArr >= 0 ? normalizeArrangement(cols[idxArr]) : undefined,
          employment_type: idxEmp >= 0 && cols[idxEmp] ? cols[idxEmp] : undefined,
          experience_level: idxExp >= 0 && cols[idxExp] ? cols[idxExp] : undefined,
          salary_text: idxSalary >= 0 && cols[idxSalary] ? cols[idxSalary] : undefined,
          description: idxDesc >= 0 && cols[idxDesc] ? cols[idxDesc] : undefined,
          validUrl: isValidHttpUrl(rawUrl),
        });
      }
      return results;
    }

    return rows
      .map((cols, idx): ParsedBatchItem | null => {
        const url = (cols[0] || '').trim();
        if (!url || url.startsWith('#')) return null;
        return {
          id: `csv-row-${idx}`,
          vacancy_url: url,
          title: cols[1] || undefined,
          company: cols[2] || undefined,
          location: cols[3] || undefined,
          validUrl: isValidHttpUrl(url),
        };
      })
      .filter((x): x is ParsedBatchItem => x !== null);
  }

  // 3. Plain text (.txt) or generic URL list: one or more URLs per line, ignoring # comments
  const lines = trimmed.split(/\r?\n/);
  const items: ParsedBatchItem[] = [];
  lines.forEach((rawLine, lineIdx) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return;
    // Support whitespace/comma-separated URLs or "url | title | company" pipe syntax
    if (line.includes('|')) {
      const [u, t, c, loc] = line.split('|').map((s) => s.trim());
      if (u) {
        items.push({
          id: `txt-${lineIdx}`,
          vacancy_url: u,
          title: t || undefined,
          company: c || undefined,
          location: loc || undefined,
          validUrl: isValidHttpUrl(u),
        });
      }
      return;
    }
    const tokens = line.split(/[\s,;]+/).filter(Boolean);
    for (let t = 0; t < tokens.length; t++) {
      const candidate = tokens[t].trim();
      if (candidate) {
        items.push({
          id: `txt-${lineIdx}-${t}`,
          vacancy_url: candidate,
          validUrl: isValidHttpUrl(candidate),
        });
      }
    }
  });

  return items;
}

export function ImportJobModal({ isOpen, onClose, onImported }: ImportJobModalProps) {
  const [mode, setMode] = useState<'single' | 'batch' | 'jobstreet'>('single');

  // Single vacancy form state
  const [vacancyUrl, setVacancyUrl] = useState('');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [location, setLocation] = useState('Jakarta, Indonesia');
  const [workArrangement, setWorkArrangement] = useState<WorkArrangement>('Hybrid');
  const [employmentType, setEmploymentType] = useState('Full-time');
  const [experienceLevel, setExperienceLevel] = useState('Mid Level');
  const [salaryMin, setSalaryMin] = useState('');
  const [salaryMax, setSalaryMax] = useState('');
  const [salaryNegotiable, setSalaryNegotiable] = useState(true);
  const [source, setSource] = useState('Glints Manual Import');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Batch file import state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [batchFilename, setBatchFilename] = useState<string>('');
  const [batchItems, setBatchItems] = useState<ParsedBatchItem[]>([]);
  const [batchDefaultLocation, setBatchDefaultLocation] = useState('Jakarta, Indonesia');
  const [batchDefaultArrangement, setBatchDefaultArrangement] =
    useState<WorkArrangement>('Hybrid');
  const [batchSource, setBatchSource] = useState('Batch URL File Import');
  const [batchImporting, setBatchImporting] = useState(false);
  const [batchResult, setBatchResult] = useState<{
    createdCount: number;
    skippedDuplicates: Array<{ vacancy_url: string; reason: string }>;
    failed: Array<{ vacancy_url: string; reason: string }>;
  } | null>(null);

  // JobStreet scraper state
  const [jsBaseUrl, setJsBaseUrl] = useState(
    'https://id.jobstreet.com/id/security-Engineer-jobs/in-Jakarta-Raya'
  );
  const [jsStartPage, setJsStartPage] = useState(2);
  const [jsEndPage, setJsEndPage] = useState(20);
  const [jsScraping, setJsScraping] = useState(false);
  const [jsStatusNotice, setJsStatusNotice] = useState<string | null>(null);
  const [jsBlocked, setJsBlocked] = useState(false);
  const [jsPastedHtml, setJsPastedHtml] = useState('');
  const [jsListings, setJsListings] = useState<
    Array<{
      id: string;
      title: string;
      company: string;
      salary_text: string;
      salary_min_idr: number | null;
      salary_max_idr: number | null;
      salary_negotiable: boolean;
      location: string;
      vacancy_url: string;
    }>
  >([]);
  const [jsImporting, setJsImporting] = useState(false);
  const jsHtmlInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const minVal = salaryMin.trim() ? Number(salaryMin.replace(/[^0-9]/g, '')) : null;
      const maxVal = salaryMax.trim() ? Number(salaryMax.replace(/[^0-9]/g, '')) : null;

      let salaryText = '';
      if (minVal && maxVal) {
        salaryText = `IDR ${minVal.toLocaleString('en-US')} – ${maxVal.toLocaleString('en-US')}`;
      } else if (minVal) {
        salaryText = `From IDR ${minVal.toLocaleString('en-US')}`;
      } else {
        salaryText = salaryNegotiable ? 'Negotiable / Undisclosed' : 'Not specified';
      }

      const { job } = await api.createJob({
        title,
        company,
        location,
        work_arrangement: workArrangement,
        employment_type: employmentType,
        experience_level: experienceLevel,
        salary_min_idr: minVal,
        salary_max_idr: maxVal,
        salary_text: salaryText,
        salary_negotiable: salaryNegotiable,
        source,
        vacancy_url: vacancyUrl,
        description,
      });

      setVacancyUrl('');
      setTitle('');
      setCompany('');
      setSalaryMin('');
      setSalaryMax('');
      setDescription('');
      onImported(job);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import vacancy.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBatchFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setError(null);
    setBatchResult(null);
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setError('URL list file must be smaller than 2 MB.');
      return;
    }

    try {
      const text = await file.text();
      const parsed = parseBatchFileContent(file.name, text);
      setBatchFilename(file.name);
      setBatchItems(parsed);
      if (parsed.length === 0) {
        setError('No URLs found in the selected file. Add one URL per line (.txt) or CSV/JSON.');
      }
    } catch {
      setError('Could not read the selected file.');
    }
  }

  function handleRemoveBatchItem(id: string) {
    setBatchItems((prev) => prev.filter((item) => item.id !== id));
  }

  async function handleBatchImportSubmit(e: FormEvent) {
    e.preventDefault();
    const validItems = batchItems.filter((item) => item.validUrl);
    if (validItems.length === 0) {
      setError('No valid http(s) URLs ready to import.');
      return;
    }

    setBatchImporting(true);
    setError(null);
    setBatchResult(null);

    try {
      const res = await api.bulkImportJobs(
        validItems.slice(0, 200).map((item) => ({
          vacancy_url: item.vacancy_url,
          title: item.title,
          company: item.company,
          location: item.location || batchDefaultLocation,
          work_arrangement: item.work_arrangement || batchDefaultArrangement,
          employment_type: item.employment_type,
          experience_level: item.experience_level,
          salary_text: item.salary_text,
          source: batchSource,
          description: item.description,
        }))
      );

      setBatchResult({
        createdCount: res.created.length,
        skippedDuplicates: res.skippedDuplicates,
        failed: res.failed,
      });

      if (res.created.length > 0) {
        onImported(res.created[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Batch import failed.');
    } finally {
      setBatchImporting(false);
    }
  }

  async function handleScrapeJobStreet() {
    setError(null);
    setJsStatusNotice(null);
    setJsBlocked(false);
    setBatchResult(null);
    setJsScraping(true);

    try {
      const res = await api.scrapeJobStreet({
        baseUrl: jsBaseUrl,
        startPage: jsStartPage,
        endPage: jsEndPage,
      });
      setJsBlocked(res.blockedByAntiBot);
      setJsStatusNotice(res.message);
      setJsListings(
        res.listings.map((item, idx) => ({
          id: `js-${idx}-${Date.now()}`,
          ...item,
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to scrape JobStreet pages.');
    } finally {
      setJsScraping(false);
    }
  }

  async function handleJobStreetHtmlFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setError(null);
    setJsStatusNotice(null);
    setJsScraping(true);

    try {
      const pages: Array<{ filename: string; html: string }> = [];
      for (const f of Array.from(files).slice(0, 25)) {
        pages.push({ filename: f.name, html: await f.text() });
      }
      const res = await api.parseJobStreetHtml(pages);
      setJsBlocked(res.challengePages > 0 && res.listings.length === 0);
      setJsStatusNotice(res.message);
      setJsListings(
        res.listings.map((item, idx) => ({
          id: `js-file-${idx}-${Date.now()}`,
          ...item,
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse HTML files.');
    } finally {
      setJsScraping(false);
    }
  }

  async function handleParsePastedHtml() {
    if (jsPastedHtml.trim().length < 50) {
      setError('Paste full JobStreet page HTML source first.');
      return;
    }
    setError(null);
    setJsStatusNotice(null);
    setJsScraping(true);
    try {
      const res = await api.parseJobStreetHtml([{ filename: 'pasted.html', html: jsPastedHtml }]);
      setJsBlocked(res.challengePages > 0 && res.listings.length === 0);
      setJsStatusNotice(res.message);
      setJsListings(
        res.listings.map((item, idx) => ({
          id: `js-paste-${idx}-${Date.now()}`,
          ...item,
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse pasted HTML.');
    } finally {
      setJsScraping(false);
    }
  }

  async function handleImportJobStreetListings(e: FormEvent) {
    e.preventDefault();
    if (jsListings.length === 0) return;

    setJsImporting(true);
    setError(null);
    setBatchResult(null);
    try {
      const res = await api.bulkImportJobs(
        jsListings.slice(0, 200).map((item) => ({
          vacancy_url: item.vacancy_url,
          title: item.title,
          company: item.company,
          location: item.location || 'Jakarta Raya',
          work_arrangement: 'On-site',
          salary_min_idr: item.salary_min_idr,
          salary_max_idr: item.salary_max_idr,
          salary_text: item.salary_text,
          salary_negotiable: item.salary_negotiable,
          source: 'JobStreet Scraper',
          description: `JobStreet listing scraped for ${item.title} at ${item.company} (${item.location}). Salary: ${item.salary_text}. Open original vacancy URL to copy full requirements before AI analysis.`,
        }))
      );
      setBatchResult({
        createdCount: res.created.length,
        skippedDuplicates: res.skippedDuplicates,
        failed: res.failed,
      });
      if (res.created.length > 0) {
        onImported(res.created[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import scraped vacancies.');
    } finally {
      setJsImporting(false);
    }
  }

  const validBatchCount = batchItems.filter((i) => i.validUrl).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-job-title"
    >
      <div className="w-full max-w-2xl bg-[#111827] border border-slate-800 rounded-lg shadow-2xl my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div>
            <h2 id="import-job-title" className="text-base font-semibold text-slate-100">
              Import Vacancy
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Add a single posting or import multiple vacancy URLs from one file
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-100 rounded-md transition-colors"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="px-6 pt-4">
          <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-[#0B1120] border border-slate-800 rounded-md">
            <button
              type="button"
              onClick={() => {
                setMode('single');
                setError(null);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                mode === 'single'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Single Vacancy
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('batch');
                setError(null);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                mode === 'batch'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileUp className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Multiple URLs (File)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('jobstreet');
                setError(null);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                mode === 'jobstreet'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Globe className="w-3.5 h-3.5" aria-hidden="true" />
              <span>JobStreet Scraper</span>
            </button>
          </div>
        </div>

        {mode === 'single' ? (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div className="flex items-start gap-2.5 p-3 bg-slate-900/80 border border-slate-800 rounded-md text-xs text-slate-300">
              <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                Compliance Policy: Paste vacancy details copied from Glints or an authorized job
                feed. Automated scraping, CAPTCHA bypass, and unattended submission are disabled.
              </span>
            </div>

            {error && (
              <div className="p-3 bg-rose-950/50 border border-rose-800/70 rounded-md text-xs text-rose-200">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Original Vacancy URL <span className="text-rose-400">*</span>
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://glints.com/id/opportunities/jobs/..."
                  value={vacancyUrl}
                  onChange={(e) => setVacancyUrl(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Position Title <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Network Security Engineer"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Company Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. PT Cyber Nusantara"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Location</label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Work Arrangement
                </label>
                <select
                  value={workArrangement}
                  onChange={(e) => setWorkArrangement(e.target.value as WorkArrangement)}
                  className="w-full px-3 py-2 text-sm bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-sky-500"
                >
                  <option value="On-site">On-site</option>
                  <option value="Hybrid">Hybrid</option>
                  <option value="Remote">Remote</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Employment Type
                </label>
                <select
                  value={employmentType}
                  onChange={(e) => setEmploymentType(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-sky-500"
                >
                  <option value="Full-time">Full-time</option>
                  <option value="Contract">Contract</option>
                  <option value="Internship">Internship</option>
                  <option value="Part-time">Part-time</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Experience Level
                </label>
                <select
                  value={experienceLevel}
                  onChange={(e) => setExperienceLevel(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-sky-500"
                >
                  <option value="Junior-Mid Level">Junior-Mid Level</option>
                  <option value="Mid Level">Mid Level</option>
                  <option value="Senior Level">Senior Level</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Salary Min (IDR / month)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="e.g. 10000000"
                  value={salaryMin}
                  onChange={(e) => setSalaryMin(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Salary Max (IDR / month)
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="e.g. 15000000"
                  value={salaryMax}
                  onChange={(e) => setSalaryMax(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Source</label>
                <input
                  type="text"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="flex items-end pb-2">
                <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={salaryNegotiable}
                    onChange={(e) => setSalaryNegotiable(e.target.checked)}
                    className="rounded border-slate-700 bg-[#0B1120] text-sky-500 focus:ring-sky-500"
                  />
                  <span>Salary is negotiable or undisclosed</span>
                </label>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Job Description & Requirements <span className="text-rose-400">*</span>
                </label>
                <textarea
                  required
                  rows={6}
                  placeholder="Paste the complete job responsibilities, technical skills (Fortinet, Palo Alto, SIEM, ISO 27001, etc.), education, and certification requirements..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-slate-100 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
              >
                {submitting ? 'Saving Vacancy...' : 'Save Vacancy'}
              </button>
            </div>
          </form>
        ) : mode === 'batch' ? (
          <form onSubmit={handleBatchImportSubmit} className="p-6 space-y-4">
            <div className="flex items-start gap-2.5 p-3 bg-slate-900/80 border border-slate-800 rounded-md text-xs text-slate-300">
              <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                Upload one <code className="font-mono text-slate-100">.txt</code> (one URL per
                line), <code className="font-mono text-slate-100">.csv</code>, or{' '}
                <code className="font-mono text-slate-100">.json</code> file (max 200 URLs).
                Duplicates are skipped automatically; no unauthorized scraping is performed.
              </span>
            </div>

            {error && (
              <div className="p-3 bg-rose-950/50 border border-rose-800/70 rounded-md text-xs text-rose-200">
                {error}
              </div>
            )}

            {batchResult && (
              <div className="p-3.5 bg-emerald-950/40 border border-emerald-800/60 rounded-md text-xs text-emerald-200 space-y-1.5">
                <div className="font-medium">
                  Imported {batchResult.createdCount} vacancies · Skipped{' '}
                  {batchResult.skippedDuplicates.length} duplicates · Failed{' '}
                  {batchResult.failed.length}
                </div>
                {batchResult.skippedDuplicates.length > 0 && (
                  <div className="text-slate-300 max-h-24 overflow-y-auto space-y-0.5">
                    {batchResult.skippedDuplicates.map((d, i) => (
                      <div key={i} className="truncate font-mono text-[11px]">
                        Skipped: {d.vacancy_url} — {d.reason}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Select URL List File (.txt, .csv, .json)
              </label>
              <div className="flex items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.csv,.json,text/plain,text/csv,application/json"
                  onChange={handleBatchFileChange}
                  className="w-full text-xs text-slate-300 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border file:border-slate-700 file:text-xs file:font-medium file:bg-[#0B1120] file:text-slate-200 hover:file:border-slate-500"
                />
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500">
                Supported formats: plain URL lines, <span className="font-mono">url | title | company</span>, CSV headers (<span className="font-mono">url,title,company,location,work_arrangement,salary_text,description</span>), or JSON array.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Default Location
                </label>
                <input
                  type="text"
                  value={batchDefaultLocation}
                  onChange={(e) => setBatchDefaultLocation(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Default Arrangement
                </label>
                <select
                  value={batchDefaultArrangement}
                  onChange={(e) => setBatchDefaultArrangement(e.target.value as WorkArrangement)}
                  className="w-full px-3 py-1.5 text-xs bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-sky-500"
                >
                  <option value="On-site">On-site</option>
                  <option value="Hybrid">Hybrid</option>
                  <option value="Remote">Remote</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Source Label
                </label>
                <input
                  type="text"
                  value={batchSource}
                  onChange={(e) => setBatchSource(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            {batchItems.length > 0 && (
              <div className="border border-slate-800 rounded-md overflow-hidden">
                <div className="px-3 py-2 bg-[#0B1120] border-b border-slate-800 flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-medium truncate">
                    {batchFilename} — {validBatchCount} valid / {batchItems.length} parsed
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setBatchItems([]);
                      setBatchFilename('');
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="text-slate-400 hover:text-slate-200 whitespace-nowrap"
                  >
                    Clear List
                  </button>
                </div>
                <div className="max-h-52 overflow-y-auto divide-y divide-slate-800/70">
                  {batchItems.map((item, index) => (
                    <div
                      key={item.id}
                      className="px-3 py-2 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-slate-500 tabular-nums">{index + 1}.</span>
                          <span
                            className={`font-mono truncate ${
                              item.validUrl ? 'text-slate-200' : 'text-rose-400'
                            }`}
                          >
                            {item.vacancy_url}
                          </span>
                        </div>
                        {(item.title || item.company) && (
                          <div className="text-[11px] text-slate-400 truncate pl-5">
                            {item.title || 'Derived from URL'} · {item.company || 'Pending Company'}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`text-[11px] font-medium ${
                            item.validUrl ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {item.validUrl ? 'Ready' : 'Invalid URL'}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveBatchItem(item.id)}
                          className="p-1 text-slate-500 hover:text-rose-400"
                          aria-label="Remove URL from batch"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-slate-100 transition-colors"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={batchImporting || validBatchCount === 0}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
              >
                <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {batchImporting
                    ? 'Importing...'
                    : `Import ${validBatchCount} ${validBatchCount === 1 ? 'Vacancy' : 'Vacancies'}`}
                </span>
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleImportJobStreetListings} className="p-6 space-y-4">
            <div className="flex items-start gap-2.5 p-3 bg-slate-900/80 border border-slate-800 rounded-md text-xs text-slate-300">
              <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                Extracts <strong className="text-slate-100">Job Title</strong>,{' '}
                <strong className="text-slate-100">Company Name</strong>, and{' '}
                <strong className="text-slate-100">Salary Range</strong> across paginated JobStreet
                results. Never bypasses Cloudflare/CAPTCHA; if blocked, upload saved HTML pages or
                run <code className="font-mono text-slate-100">node scripts/capture-jobstreet.mjs</code>.
              </span>
            </div>

            {error && (
              <div className="p-3 bg-rose-950/50 border border-rose-800/70 rounded-md text-xs text-rose-200">
                {error}
              </div>
            )}

            {jsStatusNotice && (
              <div
                className={`p-3 rounded-md text-xs border ${
                  jsBlocked
                    ? 'bg-amber-950/40 border-amber-800/70 text-amber-200'
                    : 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200'
                }`}
              >
                {jsStatusNotice}
              </div>
            )}

            {batchResult && (
              <div className="p-3 bg-emerald-950/40 border border-emerald-800/60 rounded-md text-xs text-emerald-200">
                Imported {batchResult.createdCount} JobStreet vacancies · Skipped{' '}
                {batchResult.skippedDuplicates.length} duplicates · Failed{' '}
                {batchResult.failed.length}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-6">
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  JobStreet Search URL
                </label>
                <input
                  type="url"
                  value={jsBaseUrl}
                  onChange={(e) => setJsBaseUrl(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Start Page
                </label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={jsStartPage}
                  onChange={(e) => setJsStartPage(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full px-3 py-2 text-xs font-mono bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-300 mb-1.5">End Page</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={jsEndPage}
                  onChange={(e) => setJsEndPage(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full px-3 py-2 text-xs font-mono bg-[#0B1120] border border-slate-700 rounded-md text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>
              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={handleScrapeJobStreet}
                  disabled={jsScraping}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
                >
                  {jsScraping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  <span>{jsScraping ? 'Scanning...' : `Scrape ${jsStartPage}–${jsEndPage}`}</span>
                </button>
              </div>
            </div>

            {/* Saved HTML / Page Source Extractor */}
            <div className="p-3.5 bg-[#0B1120] border border-slate-800 rounded-md space-y-3">
              <div className="text-xs font-medium text-slate-200">
                Saved HTML / Browser Page Source Extractor (Pages {jsStartPage}–{jsEndPage})
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                <input
                  ref={jsHtmlInputRef}
                  type="file"
                  multiple
                  accept=".html,.htm,text/html"
                  onChange={handleJobStreetHtmlFiles}
                  className="w-full text-xs text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-slate-700 file:text-xs file:font-medium file:bg-[#111827] file:text-slate-200 hover:file:border-slate-500"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Or paste JobStreet page HTML source..."
                    value={jsPastedHtml}
                    onChange={(e) => setJsPastedHtml(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 text-xs bg-[#111827] border border-slate-700 rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                  />
                  <button
                    type="button"
                    onClick={handleParsePastedHtml}
                    disabled={jsScraping || !jsPastedHtml.trim()}
                    className="px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 rounded-md whitespace-nowrap"
                  >
                    Extract
                  </button>
                </div>
              </div>
            </div>

            {jsListings.length > 0 && (
              <div className="border border-slate-800 rounded-md overflow-hidden">
                <div className="px-3 py-2 bg-[#0B1120] border-b border-slate-800 flex items-center justify-between text-xs">
                  <span className="text-slate-200 font-medium">
                    Extracted Listings ({jsListings.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => setJsListings([])}
                    className="text-slate-400 hover:text-slate-200"
                  >
                    Clear
                  </button>
                </div>
                <div className="max-h-56 overflow-y-auto overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 bg-[#0B1120]/60">
                        <th className="py-2 px-3">Job Title</th>
                        <th className="py-2 px-3">Company</th>
                        <th className="py-2 px-3">Salary Range</th>
                        <th className="py-2 px-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {jsListings.map((item) => (
                        <tr key={item.id}>
                          <td className="py-2 px-3 text-slate-100 font-medium">{item.title}</td>
                          <td className="py-2 px-3 text-slate-300">{item.company}</td>
                          <td className="py-2 px-3 font-mono text-sky-300 tabular-nums">
                            {item.salary_text}
                          </td>
                          <td className="py-2 px-2 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                setJsListings((prev) => prev.filter((x) => x.id !== item.id))
                              }
                              className="p-1 text-slate-500 hover:text-rose-400"
                              aria-label="Remove listing"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-slate-100 transition-colors"
              >
                Close
              </button>
              <button
                type="submit"
                disabled={jsImporting || jsListings.length === 0}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-md transition-colors whitespace-nowrap"
              >
                <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {jsImporting
                    ? 'Importing...'
                    : `Import ${jsListings.length} Extracted ${jsListings.length === 1 ? 'Vacancy' : 'Vacancies'}`}
                </span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
