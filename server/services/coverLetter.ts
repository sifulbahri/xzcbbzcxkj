import { getSettingsRecord } from '../database.ts';
import type { CvProfile, JobRecord } from '../types.ts';
import { generatePlainText } from './aiProvider.ts';
import { getCandidateProfileContext } from './jobMatcher.ts';

export async function generateCoverLetter(params: {
  job: JobRecord;
  cvId?: number | null;
  tone?: string;
}): Promise<{ content: string; modelUsed: string; cvIdUsed: number | null }> {
  const candidate = getCandidateProfileContext(params.cvId);

  const systemPrompt = `You are an expert technical career writer specializing in cybersecurity, network security, and security presales roles in Indonesia.
Write a tailored, concise, high-impact cover letter for the candidate applying to the specified role.

CRITICAL TRUTHFULNESS RULES:
1. Base EVERY technical claim, tool, year of experience, and project strictly on the Candidate Profile/CV provided.
2. NEVER fabricate certifications, degrees, job titles, employers, or tools not present in the Candidate Profile/CV.
3. Keep the letter professional, specific to the company and role responsibilities, and 3-4 well-structured paragraphs (around 220-320 words).
4. Do NOT include placeholder brackets like [Company Address] unless clearly labeled for the user's contact header; address the hiring team directly (e.g., "Dear Hiring Team at <Company>,").`;

  const userPrompt = `CANDIDATE SOURCE: ${candidate.sourceLabel}
CANDIDATE PROFILE / CV:
"""
${candidate.profileText.slice(0, 12000)}
"""

TARGET POSITION: ${params.job.title}
COMPANY: ${params.job.company}
LOCATION / WORK ARRANGEMENT: ${params.job.location} (${params.job.work_arrangement})
REQUESTED TONE: ${params.tone || 'Confident, technical, concise'}

JOB DESCRIPTION:
"""
${params.job.description.slice(0, 10000)}
"""`;

  const { text, modelUsed } = await generatePlainText({
    systemPrompt,
    userPrompt,
  });

  return {
    content: text,
    modelUsed,
    cvIdUsed: candidate.cv ? candidate.cv.id : null,
  };
}

export async function generateCvRecommendations(
  cv: CvProfile
): Promise<{ recommendations: string; modelUsed: string }> {
  const settings = getSettingsRecord();

  const systemPrompt = `You are a senior cybersecurity hiring manager in Jakarta reviewing a candidate's CV.
Provide concrete, actionable CV improvement recommendations tailored to these target roles: ${settings.target_positions.join(', ')}.

STRICT ACCURACY RULES:
1. NEVER suggest adding fake experience, fabricated metrics, or certifications the candidate has not earned.
2. Focus on clarity, quantifiable framing of existing real work (LLD, UAT, firewall migrations, SIEM tuning, presales PoCs), keyword alignment for ATS/Glints recruiters, formatting, and identifying genuine certification/skill gaps to study next.
3. Organize your feedback cleanly into 4 clear sections:
   - Strengths Observed in This CV
   - Phrasing & Impact Improvements (Using Existing Experience)
   - Target Role Alignment Gaps (Jakarta Cybersecurity Market)
   - Recommended Next Steps`;

  const userPrompt = `CV VERSION NAME: ${cv.name} (${cv.original_filename})
EXTRACTED CV TEXT:
"""
${cv.extracted_text.slice(0, 14000)}
"""`;

  const { text, modelUsed } = await generatePlainText({
    systemPrompt,
    userPrompt,
  });

  return {
    recommendations: text,
    modelUsed,
  };
}
