import { Router } from 'express';
import fs from 'fs';
import { getDb } from '../database.ts';
import { aiRateLimiter, safeResolveInDir, sanitizeLogError } from '../middleware/security.ts';
import { generateCvRecommendations } from '../services/coverLetter.ts';
import { cvUploadMiddleware, extractCvText, UPLOADS_DIR } from '../services/cvParser.ts';
import type { CvProfile } from '../types.ts';

const router = Router();

function mapCvRow(row: Record<string, unknown>): CvProfile {
  return {
    id: Number(row.id),
    name: String(row.name),
    original_filename: String(row.original_filename),
    stored_filename: String(row.stored_filename),
    mime_type: String(row.mime_type),
    file_size: Number(row.file_size),
    extracted_text: String(row.extracted_text),
    is_primary: Boolean(row.is_primary),
    ai_recommendations: row.ai_recommendations ? String(row.ai_recommendations) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

router.get('/', (_req, res) => {
  try {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM cv_profiles ORDER BY is_primary DESC, created_at DESC, id DESC')
      .all() as Array<Record<string, unknown>>;
    res.json({ cvs: rows.map(mapCvRow) });
  } catch (err) {
    console.error('[GET /api/cv]', sanitizeLogError(err));
    res.status(500).json({ error: 'Failed to load CV profiles.' });
  }
});

router.post('/upload', (req, res) => {
  cvUploadMiddleware.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) {
      res.status(400).json({ error: uploadErr.message || 'CV upload validation failed.' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'Please select a PDF or DOCX CV file to upload.' });
      return;
    }

    const storedFilename = req.file.filename;
    try {
      const extractedText = await extractCvText(storedFilename, req.file.originalname);
      const db = getDb();

      const customName = String(req.body?.name || '').trim();
      const label = customName || req.file.originalname.replace(/\.(pdf|docx)$/i, '');

      const existingCount = (
        db.prepare('SELECT COUNT(*) AS cnt FROM cv_profiles').get() as { cnt: number }
      ).cnt;
      const setPrimary = existingCount === 0 || req.body?.is_primary === 'true' || req.body?.is_primary === true;

      const tx = db.transaction(() => {
        if (setPrimary) {
          db.prepare('UPDATE cv_profiles SET is_primary = 0').run();
        }
        const insertRes = db
          .prepare(
            `INSERT INTO cv_profiles (
              name, original_filename, stored_filename, mime_type, file_size, extracted_text, is_primary
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            label,
            req.file!.originalname,
            storedFilename,
            req.file!.mimetype,
            req.file!.size,
            extractedText,
            setPrimary ? 1 : 0
          );

        if (setPrimary) {
          db.prepare(`UPDATE user_settings SET preferred_cv_id = ?, updated_at = datetime('now') WHERE id = 1`).run(
            insertRes.lastInsertRowid
          );
        }

        return insertRes.lastInsertRowid;
      });

      const cvId = tx();
      const created = db.prepare('SELECT * FROM cv_profiles WHERE id = ?').get(cvId) as Record<
        string,
        unknown
      >;

      res.status(201).json({ cv: mapCvRow(created) });
    } catch (err) {
      // Remove uploaded file on parsing failure
      try {
        const target = safeResolveInDir(UPLOADS_DIR, storedFilename);
        if (fs.existsSync(target)) {
          fs.unlinkSync(target);
        }
      } catch {
        // ignore cleanup error
      }
      const msg = sanitizeLogError(err);
      console.error('[POST /api/cv/upload]', msg);
      res.status(400).json({ error: msg });
    }
  });
});

router.patch('/:id/primary', (req, res) => {
  try {
    const cvId = Number(req.params.id);
    if (!Number.isInteger(cvId) || cvId <= 0) {
      res.status(400).json({ error: 'Invalid CV ID.' });
      return;
    }

    const db = getDb();
    const existing = db.prepare('SELECT * FROM cv_profiles WHERE id = ?').get(cvId) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'CV profile not found.' });
      return;
    }

    const tx = db.transaction(() => {
      db.prepare('UPDATE cv_profiles SET is_primary = 0').run();
      db.prepare(`UPDATE cv_profiles SET is_primary = 1, updated_at = datetime('now') WHERE id = ?`).run(
        cvId
      );
      db.prepare(`UPDATE user_settings SET preferred_cv_id = ?, updated_at = datetime('now') WHERE id = 1`).run(
        cvId
      );
    });
    tx();

    const updated = db.prepare('SELECT * FROM cv_profiles WHERE id = ?').get(cvId) as Record<
      string,
      unknown
    >;
    res.json({ cv: mapCvRow(updated) });
  } catch (err) {
    console.error('[PATCH /api/cv/:id/primary]', sanitizeLogError(err));
    res.status(500).json({ error: 'Failed to update primary CV.' });
  }
});

router.post('/:id/recommendations', aiRateLimiter, async (req, res) => {
  try {
    const cvId = Number(req.params.id);
    if (!Number.isInteger(cvId) || cvId <= 0) {
      res.status(400).json({ error: 'Invalid CV ID.' });
      return;
    }

    const db = getDb();
    const row = db.prepare('SELECT * FROM cv_profiles WHERE id = ?').get(cvId) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'CV profile not found.' });
      return;
    }

    const cv = mapCvRow(row);
    const { recommendations, modelUsed } = await generateCvRecommendations(cv);

    db.prepare(
      `UPDATE cv_profiles SET ai_recommendations = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(recommendations, cvId);

    const updated = db.prepare('SELECT * FROM cv_profiles WHERE id = ?').get(cvId) as Record<
      string,
      unknown
    >;
    res.json({ cv: mapCvRow(updated), modelUsed });
  } catch (err) {
    const msg = sanitizeLogError(err);
    console.error('[POST /api/cv/:id/recommendations]', msg);
    const status = msg.includes('not configured') ? 503 : 500;
    res.status(status).json({ error: msg });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const cvId = Number(req.params.id);
    if (!Number.isInteger(cvId) || cvId <= 0) {
      res.status(400).json({ error: 'Invalid CV ID.' });
      return;
    }

    const db = getDb();
    const row = db.prepare('SELECT * FROM cv_profiles WHERE id = ?').get(cvId) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'CV profile not found.' });
      return;
    }

    const storedFilename = String(row.stored_filename);
    const wasPrimary = Boolean(row.is_primary);

    db.prepare('DELETE FROM cv_profiles WHERE id = ?').run(cvId);

    if (wasPrimary) {
      const next = db
        .prepare('SELECT id FROM cv_profiles ORDER BY created_at DESC LIMIT 1')
        .get() as { id: number } | undefined;
      if (next) {
        db.prepare('UPDATE cv_profiles SET is_primary = 1 WHERE id = ?').run(next.id);
        db.prepare('UPDATE user_settings SET preferred_cv_id = ? WHERE id = 1').run(next.id);
      } else {
        db.prepare('UPDATE user_settings SET preferred_cv_id = NULL WHERE id = 1').run();
      }
    }

    try {
      const filePath = safeResolveInDir(UPLOADS_DIR, storedFilename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // ignore disk cleanup error
    }

    res.json({ deleted: true });
  } catch (err) {
    console.error('[DELETE /api/cv/:id]', sanitizeLogError(err));
    res.status(500).json({ error: 'Failed to delete CV.' });
  }
});

export default router;
