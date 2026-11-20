export type ApplicationStatus =
  | 'DISCOVERED'
  | 'ANALYZED'
  | 'PREPARED'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'SUBMITTED'
  | 'INTERVIEW'
  | 'REJECTED'
  | 'WITHDRAWN';

export type WorkArrangement = 'On-site' | 'Hybrid' | 'Remote';

export type MatchClassification =
  | 'Excellent Match'
  | 'Good Match'
  | 'Moderate Match'
  | 'Low Match';

export interface UserSettings {
  id: number;
  ai_provider: 'auto' | 'openai' | 'gemini';
  openai_model: string;
  min_salary_idr: number;
  include_negotiable_salary: boolean;
  target_locations: string[];
  target_positions: string[];
  work_arrangements: WorkArrangement[];
  experience_levels: string[];
  min_match_score: number;
  preferred_cv_id: number | null;
  approval_mode: boolean;
  baseline_profile: string;
  updated_at: string;
}

export interface AiReadiness {
  configured: boolean;
  activeProvider: 'openai' | 'gemini' | 'none';
  openaiConfigured: boolean;
  geminiConfigured: boolean;
  activeModel: string;
}

export interface CvProfile {
  id: number;
  name: string;
  original_filename: string;
  stored_filename: string;
  mime_type: string;
  file_size: number;
  extracted_text: string;
  is_primary: boolean;
  ai_recommendations: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobRecord {
  id: number;
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
  status: ApplicationStatus;
  created_at: string;
  updated_at: string;
  latest_score?: number | null;
  latest_classification?: MatchClassification | null;
  application_id?: number | null;
  application_status?: ApplicationStatus | null;
}

export interface AnalysisDimension {
  score: number;
  summary: string;
}

export interface JobAnalysis {
  id: number;
  job_id: number;
  cv_id: number | null;
  suitability_score: number;
  classification: MatchClassification;
  technical_skills: AnalysisDimension;
  work_experience: AnalysisDimension;
  education: AnalysisDimension;
  certifications: AnalysisDimension;
  seniority: AnalysisDimension;
  location: AnalysisDimension;
  salary: AnalysisDimension;
  responsibilities_summary: string;
  skill_gaps: string[];
  strengths: string[];
  overall_explanation: string;
  model_used: string;
  created_at: string;
}

export interface ApplicationRecord {
  id: number;
  job_id: number;
  cv_id: number | null;
  analysis_id: number | null;
  status: ApplicationStatus;
  match_score: number | null;
  cover_letter: string;
  notes: string;
  follow_up_date: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
  job_title?: string;
  company?: string;
  location?: string;
  work_arrangement?: WorkArrangement;
  salary_text?: string;
  vacancy_url?: string;
  cv_name?: string | null;
  classification?: MatchClassification | null;
}

export interface ApplicationHistoryRecord {
  id: number;
  application_id: number;
  from_status: string | null;
  to_status: string;
  action: string;
  note: string | null;
  created_at: string;
}

export interface GeneratedDocument {
  id: number;
  application_id: number;
  job_id: number;
  cv_id: number | null;
  doc_type: string;
  content: string;
  model_used: string;
  created_at: string;
}

export interface DashboardData {
  kpis: {
    totalDiscoveredJobs: number;
    awaitingAnalysis: number;
    matchingProfile: number;
    awaitingApproval: number;
    submitted: number;
    interviews: number;
    rejections: number;
    successRate: number;
  };
  statusCounts: Record<ApplicationStatus, number>;
  matchDistribution: Array<{ label: string; range: string; count: number }>;
  activitySeries: Array<{ day: string; jobs: number; actions: number }>;
  upcomingFollowUps: Array<{
    id: number;
    status: ApplicationStatus;
    follow_up_date: string;
    job_title: string;
    company: string;
  }>;
  recentHistory: Array<{
    id: number;
    application_id: number;
    to_status: ApplicationStatus;
    action: string;
    note: string | null;
    created_at: string;
    job_title: string;
    company: string;
  }>;
}
