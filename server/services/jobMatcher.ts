import { getDb, getSettingsRecord } from '../database.ts';
import type {
  AnalysisDimension,
  CvProfile,
  JobAnalysis,
  JobRecord,
  MatchClassification,
} from '../types.ts';
import { generateStructuredJson } from './aiProvider.ts';

interface RawAnalysisOutput {
  suitability_score: number;
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
}

export function classifyMatchScore(score: number): MatchClassification {
  if (score >= 85) return 'Excellent Match';
  if (score >= 70) return 'Good Match';
  if (score >= 50) return 'Moderate Match';
  return 'Low Match';
}

export function getCandidateProfileContext(explicitCvId?: number | null): {
  cv: CvProfile | null;
  sourceLabel: string;
  profileText: string;
} {
  const db = getDb();
  const settings = getSettingsRecord();

  let cvRow: Record<string, unknown> | undefined;
  if (explicitCvId) {
    cvRow = db.prepare('SELECT * FROM cv_profiles WHERE id = ?').get(explicitCvId) as
      | Record<string, unknown>
      | undefined;
  }
  if (!cvRow && settings.preferred_cv_id) {
    cvRow = db.prepare('SELECT * FROM cv_profiles WHERE id = ?').get(settings.preferred_cv_id) as
      | Record<string, unknown>
      | undefined;
  }
  if (!cvRow) {
    cvRow = db
      .prepare('SELECT * FROM cv_profiles WHERE is_primary = 1 ORDER BY updated_at DESC LIMIT 1')
      .get() as Record<string, unknown> | undefined;
  }
  if (!cvRow) {
    cvRow = db.prepare('SELECT * FROM cv_profiles ORDER BY created_at DESC LIMIT 1').get() as
      | Record<string, unknown>
      | undefined;
  }

  if (cvRow) {
    const cv: CvProfile = {
      id: Number(cvRow.id),
      name: String(cvRow.name),
      original_filename: String(cvRow.original_filename),
      stored_filename: String(cvRow.stored_filename),
      mime_type: String(cvRow.mime_type),
      file_size: Number(cvRow.file_size),
      extracted_text: String(cvRow.extracted_text),
      is_primary: Boolean(cvRow.is_primary),
      ai_recommendations: cvRow.ai_recommendations ? String(cvRow.ai_recommendations) : null,
      created_at: String(cvRow.created_at),
      updated_at: String(cvRow.updated_at),
    };
    return {
      cv,
      sourceLabel: `Uploaded CV: ${cv.name} (${cv.original_filename})`,
      profileText: cv.extracted_text,
    };
  }

  return {
    cv: null,
    sourceLabel: 'Default Cybersecurity Profile (No CV uploaded yet)',
    profileText: settings.baseline_profile,
  };
}

function clampScore(val: unknown): number {
  const n = typeof val === 'number' ? val : Number(val);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeDimension(dim: unknown): AnalysisDimension {
  if (dim && typeof dim === 'object') {
    const obj = dim as Record<string, unknown>;
    return {
      score: clampScore(obj.score),
      summary: String(obj.summary || 'No explanation provided.').trim(),
    };
  }
  return { score: 0, summary: 'Dimension could not be evaluated.' };
}

export async function analyzeJobVacancy(
  job: JobRecord,
  explicitCvId?: number | null
): Promise<JobAnalysis> {
  const db = getDb();
  const settings = getSettingsRecord();
  const candidate = getCandidateProfileContext(explicitCvId);

  const systemPrompt = `You are a rigorous, factual cybersecurity career advisor and technical hiring evaluator in Jakarta, Indonesia.
Your task is to analyze a job vacancy against the candidate's actual profile or uploaded CV.

STRICT ACCURACY RULES:
1. NEVER invent, assume, or fabricate qualifications, certifications, employers, degrees, or technical skills that are not explicitly stated in the Candidate Profile/CV.
2. If the Candidate Profile/CV does not mention a required certification or skill, explicitly list it under skill_gaps and reduce the corresponding dimension score accurately.
3. Evaluate salary compatibility fairly: minimum expected salary is IDR ${settings.min_salary_idr.toLocaleString('en-US')}/month. ${
    settings.include_negotiable_salary
      ? 'Undisclosed or negotiable salaries should NOT be penalized heavily if the role is otherwise relevant; score salary compatibility neutrally (65-80) with an explanation.'
      : 'Undisclosed salaries should be flagged.'
  }
4. Evaluate location and work arrangement against target locations (${settings.target_locations.join(', ')}) and arrangements (${settings.work_arrangements.join(', ')}).
5. Return ONLY a valid JSON object matching this exact schema:
{
  "suitability_score": integer (0-100),
  "technical_skills": { "score": integer (0-100), "summary": string },
  "work_experience": { "score": integer (0-100), "summary": string },
  "education": { "score": integer (0-100), "summary": string },
  "certifications": { "score": integer (0-100), "summary": string },
  "seniority": { "score": integer (0-100), "summary": string },
  "location": { "score": integer (0-100), "summary": string },
  "salary": { "score": integer (0-100), "summary": string },
  "responsibilities_summary": string,
  "skill_gaps": string[],
  "strengths": string[],
  "overall_explanation": string
}`;

  const userPrompt = `CANDIDATE SOURCE: ${candidate.sourceLabel}
CANDIDATE PROFILE / CV TEXT:
"""
${candidate.profileText.slice(0, 12000)}
"""

TARGET JOB POSITIONS: ${settings.target_positions.join(', ')}
EXPERIENCE TARGET: ${settings.experience_levels.join(', ')}

JOB VACANCY TO ANALYZE:
- Title: ${job.title}
- Company: ${job.company}
- Location: ${job.location}
- Work Arrangement: ${job.work_arrangement}
- Employment Type: ${job.employment_type}
- Experience Level: ${job.experience_level}
- Salary: ${job.salary_text} (min: ${job.salary_min_idr ?? 'undisclosed'}, max: ${job.salary_max_idr ?? 'undisclosed'}, negotiable: ${job.salary_negotiable})
- Source URL: ${job.vacancy_url}

JOB DESCRIPTION:
"""
${job.description.slice(0, 12000)}
"""`;

  const { data, modelUsed } = await generateStructuredJson<RawAnalysisOutput>({
    systemPrompt,
    userPrompt,
  });

  const suitabilityScore = clampScore(data.suitability_score);
  const classification = classifyMatchScore(suitabilityScore);
  const technicalSkills = normalizeDimension(data.technical_skills);
  const workExperience = normalizeDimension(data.work_experience);
  const education = normalizeDimension(data.education);
  const certifications = normalizeDimension(data.certifications);
  const seniority = normalizeDimension(data.seniority);
  const location = normalizeDimension(data.location);
  const salary = normalizeDimension(data.salary);
  const responsibilitiesSummary = String(
    data.responsibilities_summary || 'See full job description.'
  ).trim();
  const skillGaps = Array.isArray(data.skill_gaps)
    ? data.skill_gaps.map((s) => String(s).trim()).filter(Boolean)
    : [];
  const strengths = Array.isArray(data.strengths)
    ? data.strengths.map((s) => String(s).trim()).filter(Boolean)
    : [];
  const overallExplanation = String(data.overall_explanation || '').trim();

  const insertResult = db
    .prepare(
      `INSERT INTO job_analysis (
        job_id, cv_id, suitability_score, classification,
        technical_skills_json, work_experience_json, education_json,
        certifications_json, seniority_json, location_json, salary_json,
        responsibilities_summary, skill_gaps_json, strengths_json,
        overall_explanation, model_used
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      job.id,
      candidate.cv ? candidate.cv.id : null,
      suitabilityScore,
      classification,
      JSON.stringify(technicalSkills),
      JSON.stringify(workExperience),
      JSON.stringify(education),
      JSON.stringify(certifications),
      JSON.stringify(seniority),
      JSON.stringify(location),
      JSON.stringify(salary),
      responsibilitiesSummary,
      JSON.stringify(skillGaps),
      JSON.stringify(strengths),
      overallExplanation,
      modelUsed
    );

  // Update job status to ANALYZED if it was DISCOVERED
  if (job.status === 'DISCOVERED') {
    db.prepare(`UPDATE jobs SET status = 'ANALYZED', updated_at = datetime('now') WHERE id = ?`).run(
      job.id
    );
  }

  const saved = db
    .prepare('SELECT * FROM job_analysis WHERE id = ?')
    .get(insertResult.lastInsertRowid) as Record<string, unknown>;

  return mapAnalysisRow(saved);
}

export function mapAnalysisRow(row: Record<string, unknown>): JobAnalysis {
  return {
    id: Number(row.id),
    job_id: Number(row.job_id),
    cv_id: row.cv_id !== null ? Number(row.cv_id) : null,
    suitability_score: Number(row.suitability_score),
    classification: String(row.classification) as MatchClassification,
    technical_skills: JSON.parse(String(row.technical_skills_json)) as AnalysisDimension,
    work_experience: JSON.parse(String(row.work_experience_json)) as AnalysisDimension,
    education: JSON.parse(String(row.education_json)) as AnalysisDimension,
    certifications: JSON.parse(String(row.certifications_json)) as AnalysisDimension,
    seniority: JSON.parse(String(row.seniority_json)) as AnalysisDimension,
    location: JSON.parse(String(row.location_json)) as AnalysisDimension,
    salary: JSON.parse(String(row.salary_json)) as AnalysisDimension,
    responsibilities_summary: String(row.responsibilities_summary),
    skill_gaps: JSON.parse(String(row.skill_gaps_json)) as string[],
    strengths: JSON.parse(String(row.strengths_json)) as string[],
    overall_explanation: String(row.overall_explanation),
    model_used: String(row.model_used),
    created_at: String(row.created_at),
  };
}
