import type {
  AiReadiness,
  ApplicationHistoryRecord,
  ApplicationRecord,
  ApplicationStatus,
  CvProfile,
  DashboardData,
  GeneratedDocument,
  JobAnalysis,
  JobRecord,
  UserSettings,
  WorkArrangement,
} from '../types';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options?.headers || {}),
    },
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      (payload as { error?: string }).error || `Request failed with status ${res.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export const api = {
  health: () =>
    request<{
      status: string;
      database: { connected: boolean; path: string };
      ai: { configured: boolean; activeProvider: string; activeModel: string };
    }>('/api/health'),

  getDashboard: () => request<DashboardData>('/api/dashboard'),

  getJobs: (params?: { search?: string; status?: string; arrangement?: string; minScore?: number }) => {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    if (params?.status && params.status !== 'ALL') query.set('status', params.status);
    if (params?.arrangement && params.arrangement !== 'ALL') query.set('arrangement', params.arrangement);
    if (params?.minScore && params.minScore > 0) query.set('minScore', String(params.minScore));
    const qs = query.toString();
    return request<{ jobs: JobRecord[] }>(`/api/jobs${qs ? `?${qs}` : ''}`);
  },

  createJob: (data: {
    title: string;
    company: string;
    location: string;
    work_arrangement: WorkArrangement;
    employment_type: string;
    experience_level: string;
    salary_min_idr: number | null;
    salary_max_idr: number | null;
    salary_text: string;
    salary_negotiable: boolean;
    source: string;
    vacancy_url: string;
    description: string;
  }) =>
    request<{ job: JobRecord }>('/api/jobs', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  bulkImportJobs: (
    items: Array<{
      vacancy_url: string;
      title?: string;
      company?: string;
      location?: string;
      work_arrangement?: WorkArrangement;
      employment_type?: string;
      experience_level?: string;
      salary_min_idr?: number | null;
      salary_max_idr?: number | null;
      salary_text?: string;
      salary_negotiable?: boolean;
      source?: string;
      description?: string;
    }>
  ) =>
    request<{
      created: JobRecord[];
      skippedDuplicates: Array<{ vacancy_url: string; reason: string }>;
      failed: Array<{ vacancy_url: string; reason: string }>;
    }>('/api/jobs/bulk', {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),

  scrapeJobStreet: (data: { baseUrl: string; startPage: number; endPage: number }) =>
    request<{
      listings: Array<{
        title: string;
        company: string;
        salary_text: string;
        salary_min_idr: number | null;
        salary_max_idr: number | null;
        salary_negotiable: boolean;
        location: string;
        vacancy_url: string;
        page?: number;
      }>;
      pagesScanned: number;
      blockedByAntiBot: boolean;
      statusCode: number | null;
      message: string;
    }>('/api/jobs/scrape-jobstreet', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  parseJobStreetHtml: (pages: Array<{ filename?: string; html: string }>) =>
    request<{
      listings: Array<{
        title: string;
        company: string;
        salary_text: string;
        salary_min_idr: number | null;
        salary_max_idr: number | null;
        salary_negotiable: boolean;
        location: string;
        vacancy_url: string;
        page?: number;
      }>;
      pagesParsed: number;
      challengePages: number;
      message: string;
    }>('/api/jobs/parse-jobstreet-html', {
      method: 'POST',
      body: JSON.stringify({ pages }),
    }),

  updateJob: (
    id: number,
    data: Partial<{
      title: string;
      company: string;
      location: string;
      work_arrangement: WorkArrangement;
      employment_type: string;
      experience_level: string;
      salary_text: string;
      vacancy_url: string;
      description: string;
    }>
  ) =>
    request<{ job: JobRecord }>(`/api/jobs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  getJobDetail: (id: number) =>
    request<{
      job: JobRecord;
      latestAnalysis: JobAnalysis | null;
      analysisHistory: JobAnalysis[];
    }>(`/api/jobs/${id}`),

  deleteJob: (id: number) =>
    request<{ deleted: boolean }>(`/api/jobs/${id}`, { method: 'DELETE' }),

  analyzeJob: (id: number, cvId?: number | null) =>
    request<{ analysis: JobAnalysis }>(`/api/jobs/${id}/analyze`, {
      method: 'POST',
      body: JSON.stringify({ cv_id: cvId ?? null }),
    }),

  getApplications: (params?: { status?: string; search?: string }) => {
    const query = new URLSearchParams();
    if (params?.status && params.status !== 'ALL') query.set('status', params.status);
    if (params?.search) query.set('search', params.search);
    const qs = query.toString();
    return request<{ applications: ApplicationRecord[] }>(`/api/applications${qs ? `?${qs}` : ''}`);
  },

  createApplication: (data: {
    job_id: number;
    cv_id?: number | null;
    generate_cover_letter?: boolean;
    notes?: string;
  }) =>
    request<{ application: ApplicationRecord; warning?: string | null }>('/api/applications', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getApplicationDetail: (id: number) =>
    request<{
      application: ApplicationRecord;
      job: JobRecord;
      analysis: JobAnalysis | null;
      history: ApplicationHistoryRecord[];
      documents: GeneratedDocument[];
    }>(`/api/applications/${id}`),

  generateCoverLetter: (id: number, data?: { cv_id?: number | null; tone?: string }) =>
    request<{ cover_letter: string; model_used: string; cv_id: number | null }>(
      `/api/applications/${id}/cover-letter`,
      {
        method: 'POST',
        body: JSON.stringify(data || {}),
      }
    ),

  saveCoverLetter: (id: number, coverLetter: string) =>
    request<{ updated: boolean; cover_letter: string }>(`/api/applications/${id}/cover-letter`, {
      method: 'PATCH',
      body: JSON.stringify({ cover_letter: coverLetter }),
    }),

  changeApplicationCv: (id: number, cvId: number) =>
    request<{ updated: boolean; cv_id: number; cv_name: string }>(`/api/applications/${id}/cv`, {
      method: 'PATCH',
      body: JSON.stringify({ cv_id: cvId }),
    }),

  approveApplication: (id: number, note?: string) =>
    request<{ application: ApplicationRecord }>(`/api/applications/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),

  rejectApplication: (id: number, reason?: string) =>
    request<{ application: ApplicationRecord }>(`/api/applications/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  updateApplicationStatus: (
    id: number,
    data: {
      status?: ApplicationStatus;
      notes?: string;
      follow_up_date?: string | null;
      submitted_at?: string | null;
      note?: string;
    }
  ) =>
    request<{ application: ApplicationRecord }>(`/api/applications/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  getCvs: () => request<{ cvs: CvProfile[] }>('/api/cv'),

  uploadCv: (file: File, name?: string, isPrimary?: boolean) => {
    const form = new FormData();
    form.append('file', file);
    if (name) form.append('name', name);
    if (isPrimary !== undefined) form.append('is_primary', String(isPrimary));
    return request<{ cv: CvProfile }>('/api/cv/upload', {
      method: 'POST',
      body: form,
    });
  },

  setPrimaryCv: (id: number) =>
    request<{ cv: CvProfile }>(`/api/cv/${id}/primary`, { method: 'PATCH' }),

  generateCvRecommendations: (id: number) =>
    request<{ cv: CvProfile; modelUsed: string }>(`/api/cv/${id}/recommendations`, {
      method: 'POST',
    }),

  deleteCv: (id: number) => request<{ deleted: boolean }>(`/api/cv/${id}`, { method: 'DELETE' }),

  getSettings: () => request<{ settings: UserSettings; aiReadiness: AiReadiness }>('/api/settings'),

  updateSettings: (data: Partial<UserSettings>) =>
    request<{ settings: UserSettings; aiReadiness: AiReadiness }>('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
};
