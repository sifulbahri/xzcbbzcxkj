import { Router } from 'express';
import { z } from 'zod';
import { getDb, getSettingsRecord } from '../database.ts';
import { aiRateLimiter, sanitizeLogError } from '../middleware/security.ts';
import { generateCoverLetter } from '../services/coverLetter.ts';
import { getCandidateProfileContext, mapAnalysisRow } from '../services/jobMatcher.ts';
import type {
  ApplicationHistoryRecord,
  ApplicationRecord,
  ApplicationStatus,
  GeneratedDocument,
} from '../types.ts';
import { mapJobRow } from './jobs.ts';

const router = Router();

const APPLICATION_STATUSES = [
  'DISCOVERED',
  'ANALYZED',
  'PREPARED',
  'PENDING_APPROVAL',
  'APPROVED',
  'SUBMITTED',
  'INTERVIEW',
  'REJECTED',
  'WITHDRAWN',
] as const;

function mapApplicationRow(row: Record<string, unknown>): ApplicationRecord {
  return {
    id: Number(row.id),
    job_id: Number(row.job_id),
    cv_id: row.cv_id !== null && row.cv_id !== undefined ? Number(row.cv_id) : null,
    analysis_id:
      row.analysis_id !== null && row.analysis_id !== undefined ? Number(row.analysis_id) : null,
    status: String(row.status) as ApplicationStatus,
    match_score:
      row.match_score !== null && row.match_score !== undefined ? Number(row.match_score) : null,
    cover_letter: String(row.cover_letter || ''),
    notes: String(row.notes || ''),
    follow_up_date: row.follow_up_date ? String(row.follow_up_date) : null,
    approved_at: row.approved_at ? String(row.approved_at) : null,
    rejected_at: row.rejected_at ? String(row.rejected_at) : null,
    rejection_reason: row.rejection_reason ? String(row.rejection_reason) : null,
    submitted_at: row.submitted_at ? String(row.submitted_at) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    job_title: row.job_title ? String(row.job_title) : undefined,
    company: row.company ? String(row.company) : undefined,
    location: row.location ? String(row.location) : undefined,
    work_arrangement: row.work_arrangement
      ? (String(row.work_arrangement) as ApplicationRecord['work_arrangement'])
      : undefined,
    salary_text: row.salary_text ? String(row.salary_text) : undefined,
    vacancy_url: row.vacancy_url ? String(row.vacancy_url) : undefined,
    cv_name: row.cv_name ? String(row.cv_name) : null,
    classification: row.classification
      ? (String(row.classification) as ApplicationRecord['classification'])
      : null,
  };
}

function recordHistory(
  applicationId: number,
  fromStatus: string | null,
  toStatus: string,
  action: string,
  note?: string | null
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO application_history (application_id, from_status, to_status, action, note)
     VALUES (?, ?, ?, ?, ?)`
  ).run(applicationId, fromStatus, toStatus, action, note ?? null);
}

router.get('/', (req, res) => {
  try {
    const db = getDb();
    const status = String(req.query.status || '').trim();
    const search = String(req.query.search || '').trim().toLowerCase();

    const rows = db
      .prepare(
        `SELECT a.*,
          j.title AS job_title,
          j.company AS company,
          j.location AS location,
          j.work_arrangement AS work_arrangement,
          j.salary_text AS salary_text,
          j.vacancy_url AS vacancy_url,
          c.name AS cv_name,
          ja.classification AS classification
        FROM applications a
        JOIN jobs j ON j.id = a.job_id
        LEFT JOIN cv_profiles c ON c.id = a.cv_id
        LEFT JOIN job_analysis ja ON ja.id = a.analysis_id
        ORDER BY a.updated_at DESC, a.id DESC`
      )
      .all() as Array<Record<string, unknown>>;

    let applications = rows.map(mapApplicationRow);

    if (status && status !== 'ALL') {
      applications = applications.filter((a) => a.status === status);
    }

    if (search) {
      applications = applications.filter(
        (a) =>
          (a.job_title || '').toLowerCase().includes(search) ||
          (a.company || '').toLowerCase().includes(search) ||
          (a.location || '').toLowerCase().includes(search)
      );
    }

    res.json({ applications });
  } catch (err) {
    console.error('[GET /api/applications]', sanitizeLogError(err));
    res.status(500).json({ error: 'Failed to load applications.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const schema = z.object({
      job_id: z.number().int().positive(),
      cv_id: z.number().int().positive().nullable().optional(),
      generate_cover_letter: z.boolean().default(true),
      notes: z.string().max(5000).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid application payload.' });
      return;
    }

    const db = getDb();
    const jobRow = db.prepare('SELECT * FROM jobs WHERE id = ?').get(parsed.data.job_id) as
      | Record<string, unknown>
      | undefined;
    if (!jobRow) {
      res.status(404).json({ error: 'Target job vacancy not found.' });
      return;
    }

    const existingApp = db
      .prepare('SELECT id, status FROM applications WHERE job_id = ?')
      .get(parsed.data.job_id) as { id: number; status: string } | undefined;
    if (existingApp) {
      res.status(409).json({
        error: `An application already exists for this vacancy (ID #${existingApp.id}, status: ${existingApp.status}). Duplicate applications are prevented.`,
        existingApplicationId: existingApp.id,
      });
      return;
    }

    const job = mapJobRow(jobRow);
    const candidate = getCandidateProfileContext(parsed.data.cv_id);
    const latestAnalysis = db
      .prepare('SELECT * FROM job_analysis WHERE job_id = ? ORDER BY created_at DESC, id DESC LIMIT 1')
      .get(job.id) as Record<string, unknown> | undefined;

    let coverLetterText = '';
    let generatedModel = '';
    let aiWarning: string | null = null;

    if (parsed.data.generate_cover_letter) {
      try {
        const gen = await generateCoverLetter({
          job,
          cvId: candidate.cv ? candidate.cv.id : null,
        });
        coverLetterText = gen.content;
        generatedModel = gen.modelUsed;
      } catch (aiErr) {
        aiWarning = sanitizeLogError(aiErr);
        coverLetterText = `Dear Hiring Team at ${job.company},\n\nI am writing to express my interest in the ${job.title} position in ${job.location}. Please review and customize this draft before approving.`;
      }
    }

    const settings = getSettingsRecord();
    const initialStatus: ApplicationStatus = settings.approval_mode ? 'PENDING_APPROVAL' : 'PREPARED';

    const tx = db.transaction(() => {
      const insertApp = db
        .prepare(
          `INSERT INTO applications (
            job_id, cv_id, analysis_id, status, match_score, cover_letter, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          job.id,
          candidate.cv ? candidate.cv.id : null,
          latestAnalysis ? Number(latestAnalysis.id) : null,
          initialStatus,
          latestAnalysis ? Number(latestAnalysis.suitability_score) : null,
          coverLetterText,
          parsed.data.notes?.trim() || ''
        );

      const appId = Number(insertApp.lastInsertRowid);

      db.prepare(`UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(
        initialStatus,
        job.id
      );

      recordHistory(
        appId,
        job.status,
        initialStatus,
        'APPLICATION_PREPARED',
        aiWarning
          ? `Prepared for review (AI draft fallback used: ${aiWarning})`
          : 'Application prepared and queued for review'
      );

      if (coverLetterText && generatedModel) {
        db.prepare(
          `INSERT INTO generated_documents (application_id, job_id, cv_id, doc_type, content, model_used)
           VALUES (?, ?, ?, 'cover_letter', ?, ?)`
        ).run(
          appId,
          job.id,
          candidate.cv ? candidate.cv.id : null,
          coverLetterText,
          generatedModel
        );
      }

      return appId;
    });

    const appId = tx();
    const created = db
      .prepare(
        `SELECT a.*, j.title AS job_title, j.company, j.location, j.work_arrangement, j.salary_text, j.vacancy_url, c.name AS cv_name
         FROM applications a
         JOIN jobs j ON j.id = a.job_id
         LEFT JOIN cv_profiles c ON c.id = a.cv_id
         WHERE a.id = ?`
      )
      .get(appId) as Record<string, unknown>;

    res.status(201).json({
      application: mapApplicationRow(created),
      warning: aiWarning,
    });
  } catch (err) {
    console.error('[POST /api/applications]', sanitizeLogError(err));
    res.status(500).json({ error: 'Failed to prepare application.' });
  }
});

router.get('/:id', (req, res) => {
  try {
    const appId = Number(req.params.id);
    if (!Number.isInteger(appId) || appId <= 0) {
      res.status(400).json({ error: 'Invalid application ID.' });
      return;
    }

    const db = getDb();
    const row = db
      .prepare(
        `SELECT a.*, j.title AS job_title, j.company, j.location, j.work_arrangement, j.salary_text, j.vacancy_url,
          c.name AS cv_name, ja.classification AS classification
         FROM applications a
         JOIN jobs j ON j.id = a.job_id
         LEFT JOIN cv_profiles c ON c.id = a.cv_id
         LEFT JOIN job_analysis ja ON ja.id = a.analysis_id
         WHERE a.id = ?`
      )
      .get(appId) as Record<string, unknown> | undefined;

    if (!row) {
      res.status(404).json({ error: 'Application not found.' });
      return;
    }

    const jobRow = db.prepare('SELECT * FROM jobs WHERE id = ?').get(row.job_id) as Record<
      string,
      unknown
    >;
    const analysisRow = row.analysis_id
      ? (db.prepare('SELECT * FROM job_analysis WHERE id = ?').get(row.analysis_id) as
          | Record<string, unknown>
          | undefined)
      : (db
          .prepare('SELECT * FROM job_analysis WHERE job_id = ? ORDER BY created_at DESC LIMIT 1')
          .get(row.job_id) as Record<string, unknown> | undefined);

    const history = db
      .prepare('SELECT * FROM application_history WHERE application_id = ? ORDER BY created_at DESC, id DESC')
      .all(appId) as ApplicationHistoryRecord[];

    const documents = db
      .prepare('SELECT * FROM generated_documents WHERE application_id = ? ORDER BY created_at DESC, id DESC')
      .all(appId) as GeneratedDocument[];

    res.json({
      application: mapApplicationRow(row),
      job: mapJobRow(jobRow),
      analysis: analysisRow ? mapAnalysisRow(analysisRow) : null,
      history,
      documents,
    });
  } catch (err) {
    console.error('[GET /api/applications/:id]', sanitizeLogError(err));
    res.status(500).json({ error: 'Failed to load application details.' });
  }
});

router.post('/:id/cover-letter', aiRateLimiter, async (req, res) => {
  try {
    const appId = Number(req.params.id);
    if (!Number.isInteger(appId) || appId <= 0) {
      res.status(400).json({ error: 'Invalid application ID.' });
      return;
    }

    const bodySchema = z.object({
      cv_id: z.number().int().positive().nullable().optional(),
      tone: z.string().trim().max(120).optional(),
    });
    const parsed = bodySchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid cover letter request.' });
      return;
    }

    const db = getDb();
    const appRow = db.prepare('SELECT * FROM applications WHERE id = ?').get(appId) as
      | Record<string, unknown>
      | undefined;
    if (!appRow) {
      res.status(404).json({ error: 'Application not found.' });
      return;
    }

    const jobRow = db.prepare('SELECT * FROM jobs WHERE id = ?').get(appRow.job_id) as Record<
      string,
      unknown
    >;
    const job = mapJobRow(jobRow);

    const cvId = parsed.data.cv_id !== undefined ? parsed.data.cv_id : (appRow.cv_id as number | null);
    const { content, modelUsed, cvIdUsed } = await generateCoverLetter({
      job,
      cvId,
      tone: parsed.data.tone,
    });

    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE applications SET cover_letter = ?, cv_id = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(content, cvIdUsed, appId);

      db.prepare(
        `INSERT INTO generated_documents (application_id, job_id, cv_id, doc_type, content, model_used)
         VALUES (?, ?, ?, 'cover_letter', ?, ?)`
      ).run(appId, job.id, cvIdUsed, content, modelUsed);

      recordHistory(
        appId,
        String(appRow.status),
        String(appRow.status),
        'COVER_LETTER_GENERATED',
        `Generated customized cover letter using ${modelUsed}`
      );
    });
    tx();

    res.json({ cover_letter: content, model_used: modelUsed, cv_id: cvIdUsed });
  } catch (err) {
    const msg = sanitizeLogError(err);
    console.error('[POST /api/applications/:id/cover-letter]', msg);
    const status = msg.includes('not configured') ? 503 : 500;
    res.status(status).json({ error: msg });
  }
});

router.patch('/:id/cover-letter', (req, res) => {
  try {
    const appId = Number(req.params.id);
    if (!Number.isInteger(appId) || appId <= 0) {
      res.status(400).json({ error: 'Invalid application ID.' });
      return;
    }

    const schema = z.object({
      cover_letter: z.string().trim().min(10, 'Cover letter cannot be empty').max(20000),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid cover letter.' });
      return;
    }

    const db = getDb();
    const existing = db.prepare('SELECT id, status FROM applications WHERE id = ?').get(appId) as
      | { id: number; status: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Application not found.' });
      return;
    }

    db.prepare(`UPDATE applications SET cover_letter = ?, updated_at = datetime('now') WHERE id = ?`).run(
      parsed.data.cover_letter,
      appId
    );
    recordHistory(appId, existing.status, existing.status, 'COVER_LETTER_EDITED', 'Manual edit saved');

    res.json({ updated: true, cover_letter: parsed.data.cover_letter });
  } catch (err) {
    console.error('[PATCH /api/applications/:id/cover-letter]', sanitizeLogError(err));
    res.status(500).json({ error: 'Failed to save cover letter.' });
  }
});

router.patch('/:id/cv', (req, res) => {
  try {
    const appId = Number(req.params.id);
    const schema = z.object({ cv_id: z.number().int().positive() });
    const parsed = schema.safeParse(req.body);
    if (!Number.isInteger(appId) || appId <= 0 || !parsed.success) {
      res.status(400).json({ error: 'Invalid application ID or CV ID.' });
      return;
    }

    const db = getDb();
    const app = db.prepare('SELECT id, status FROM applications WHERE id = ?').get(appId) as
      | { id: number; status: string }
      | undefined;
    const cv = db.prepare('SELECT id, name FROM cv_profiles WHERE id = ?').get(parsed.data.cv_id) as
      | { id: number; name: string }
      | undefined;

    if (!app || !cv) {
      res.status(404).json({ error: 'Application or CV profile not found.' });
      return;
    }

    db.prepare(`UPDATE applications SET cv_id = ?, updated_at = datetime('now') WHERE id = ?`).run(
      cv.id,
      appId
    );
    recordHistory(appId, app.status, app.status, 'CV_CHANGED', `Selected CV: ${cv.name}`);

    res.json({ updated: true, cv_id: cv.id, cv_name: cv.name });
  } catch (err) {
    console.error('[PATCH /api/applications/:id/cv]', sanitizeLogError(err));
    res.status(500).json({ error: 'Failed to change CV for application.' });
  }
});

router.post('/:id/approve', (req, res) => {
  try {
    const appId = Number(req.params.id);
    if (!Number.isInteger(appId) || appId <= 0) {
      res.status(400).json({ error: 'Invalid application ID.' });
      return;
    }

    const schema = z.object({
      note: z.string().trim().max(1000).optional(),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid approval payload.' });
      return;
    }

    const db = getDb();
    const existing = db.prepare('SELECT * FROM applications WHERE id = ?').get(appId) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Application not found.' });
      return;
    }

    const prevStatus = String(existing.status);
    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE applications
         SET status = 'APPROVED', approved_at = datetime('now'), rejected_at = NULL, rejection_reason = NULL, updated_at = datetime('now')
         WHERE id = ?`
      ).run(appId);

      db.prepare(`UPDATE jobs SET status = 'APPROVED', updated_at = datetime('now') WHERE id = ?`).run(
        existing.job_id
      );

      recordHistory(
        appId,
        prevStatus,
        'APPROVED',
        'USER_APPROVED',
        parsed.data.note || 'Explicitly approved by user for manual/authorized submission'
      );
    });
    tx();

    const updated = db
      .prepare(
        `SELECT a.*, j.title AS job_title, j.company, j.location, j.work_arrangement, j.salary_text, j.vacancy_url, c.name AS cv_name
         FROM applications a
         JOIN jobs j ON j.id = a.job_id
         LEFT JOIN cv_profiles c ON c.id = a.cv_id
         WHERE a.id = ?`
      )
      .get(appId) as Record<string, unknown>;

    res.json({ application: mapApplicationRow(updated) });
  } catch (err) {
    console.error('[POST /api/applications/:id/approve]', sanitizeLogError(err));
    res.status(500).json({ error: 'Failed to approve application.' });
  }
});

router.post('/:id/reject', (req, res) => {
  try {
    const appId = Number(req.params.id);
    if (!Number.isInteger(appId) || appId <= 0) {
      res.status(400).json({ error: 'Invalid application ID.' });
      return;
    }

    const schema = z.object({
      reason: z.string().trim().max(1000).optional(),
    });
    const parsed = schema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid rejection payload.' });
      return;
    }

    const db = getDb();
    const existing = db.prepare('SELECT * FROM applications WHERE id = ?').get(appId) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Application not found.' });
      return;
    }

    const prevStatus = String(existing.status);
    const reason = parsed.data.reason || 'Rejected by user during review';

    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE applications
         SET status = 'REJECTED', rejected_at = datetime('now'), rejection_reason = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(reason, appId);

      db.prepare(`UPDATE jobs SET status = 'REJECTED', updated_at = datetime('now') WHERE id = ?`).run(
        existing.job_id
      );

      recordHistory(appId, prevStatus, 'REJECTED', 'USER_REJECTED', reason);
    });
    tx();

    const updated = db
      .prepare(
        `SELECT a.*, j.title AS job_title, j.company, j.location, j.work_arrangement, j.salary_text, j.vacancy_url, c.name AS cv_name
         FROM applications a
         JOIN jobs j ON j.id = a.job_id
         LEFT JOIN cv_profiles c ON c.id = a.cv_id
         WHERE a.id = ?`
      )
      .get(appId) as Record<string, unknown>;

    res.json({ application: mapApplicationRow(updated) });
  } catch (err) {
    console.error('[POST /api/applications/:id/reject]', sanitizeLogError(err));
    res.status(500).json({ error: 'Failed to reject application.' });
  }
});

router.patch('/:id/status', (req, res) => {
  try {
    const appId = Number(req.params.id);
    if (!Number.isInteger(appId) || appId <= 0) {
      res.status(400).json({ error: 'Invalid application ID.' });
      return;
    }

    const schema = z.object({
      status: z.enum(APPLICATION_STATUSES).optional(),
      notes: z.string().max(5000).optional(),
      follow_up_date: z.string().max(40).nullable().optional(),
      submitted_at: z.string().max(40).nullable().optional(),
      note: z.string().trim().max(1000).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid status update.' });
      return;
    }

    const db = getDb();
    const existing = db.prepare('SELECT * FROM applications WHERE id = ?').get(appId) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Application not found.' });
      return;
    }

    const settings = getSettingsRecord();
    const prevStatus = String(existing.status);
    const nextStatus = parsed.data.status || prevStatus;

    // Enforce Approval Mode gate before marking SUBMITTED
    if (
      settings.approval_mode &&
      nextStatus === 'SUBMITTED' &&
      !existing.approved_at &&
      prevStatus !== 'APPROVED' &&
      prevStatus !== 'SUBMITTED'
    ) {
      res.status(409).json({
        error:
          'Approval Mode is active: this application must be explicitly approved before it can be marked as SUBMITTED.',
      });
      return;
    }

    const nextSubmittedAt =
      parsed.data.submitted_at !== undefined
        ? parsed.data.submitted_at
        : nextStatus === 'SUBMITTED' && !existing.submitted_at
          ? new Date().toISOString()
          : existing.submitted_at;

    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE applications SET
          status = ?,
          notes = ?,
          follow_up_date = ?,
          submitted_at = ?,
          updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        nextStatus,
        parsed.data.notes !== undefined ? parsed.data.notes : existing.notes,
        parsed.data.follow_up_date !== undefined
          ? parsed.data.follow_up_date
          : existing.follow_up_date,
        nextSubmittedAt,
        appId
      );

      db.prepare(`UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(
        nextStatus,
        existing.job_id
      );

      if (nextStatus !== prevStatus || parsed.data.note) {
        recordHistory(
          appId,
          prevStatus,
          nextStatus,
          nextStatus !== prevStatus ? 'STATUS_UPDATED' : 'NOTE_UPDATED',
          parsed.data.note || (nextStatus !== prevStatus ? `Changed status to ${nextStatus}` : 'Updated tracker details')
        );
      }
    });
    tx();

    const updated = db
      .prepare(
        `SELECT a.*, j.title AS job_title, j.company, j.location, j.work_arrangement, j.salary_text, j.vacancy_url, c.name AS cv_name
         FROM applications a
         JOIN jobs j ON j.id = a.job_id
         LEFT JOIN cv_profiles c ON c.id = a.cv_id
         WHERE a.id = ?`
      )
      .get(appId) as Record<string, unknown>;

    res.json({ application: mapApplicationRow(updated) });
  } catch (err) {
    console.error('[PATCH /api/applications/:id/status]', sanitizeLogError(err));
    res.status(500).json({ error: 'Failed to update application status.' });
  }
});

export default router;
