import { Router } from 'express';
import { z } from 'zod';
import { getDb, getSettingsRecord } from '../database.ts';
import { sanitizeLogError } from '../middleware/security.ts';
import { getAiReadiness } from '../services/aiProvider.ts';

const router = Router();

const updateSettingsSchema = z.object({
  ai_provider: z.enum(['auto', 'openai', 'gemini']).optional(),
  openai_model: z.string().trim().min(2).max(80).optional(),
  min_salary_idr: z.number().int().nonnegative().max(500000000).optional(),
  include_negotiable_salary: z.boolean().optional(),
  target_locations: z.array(z.string().trim().min(1).max(120)).min(1).max(20).optional(),
  target_positions: z.array(z.string().trim().min(1).max(120)).min(1).max(30).optional(),
  work_arrangements: z.array(z.enum(['On-site', 'Hybrid', 'Remote'])).min(1).optional(),
  experience_levels: z.array(z.string().trim().min(1).max(80)).min(1).optional(),
  min_match_score: z.number().int().min(0).max(100).optional(),
  preferred_cv_id: z.number().int().positive().nullable().optional(),
  approval_mode: z.boolean().optional(),
  baseline_profile: z.string().trim().min(20).max(12000).optional(),
});

router.get('/', (_req, res) => {
  try {
    const settings = getSettingsRecord();
    const aiReadiness = getAiReadiness();
    res.json({ settings, aiReadiness });
  } catch (err) {
    console.error('[GET /api/settings]', sanitizeLogError(err));
    res.status(500).json({ error: 'Failed to load settings.' });
  }
});

router.patch('/', (req, res) => {
  try {
    const parsed = updateSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid settings payload.',
        issues: parsed.error.issues,
      });
      return;
    }

    const current = getSettingsRecord();
    const input = parsed.data;
    const db = getDb();

    if (input.preferred_cv_id !== undefined && input.preferred_cv_id !== null) {
      const cvExists = db.prepare('SELECT id FROM cv_profiles WHERE id = ?').get(input.preferred_cv_id);
      if (!cvExists) {
        res.status(400).json({ error: 'Selected preferred CV does not exist.' });
        return;
      }
    }

    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE user_settings SET
          ai_provider = ?,
          openai_model = ?,
          min_salary_idr = ?,
          include_negotiable_salary = ?,
          target_locations = ?,
          target_positions = ?,
          work_arrangements = ?,
          experience_levels = ?,
          min_match_score = ?,
          preferred_cv_id = ?,
          approval_mode = ?,
          baseline_profile = ?,
          updated_at = datetime('now')
        WHERE id = 1`
      ).run(
        input.ai_provider ?? current.ai_provider,
        input.openai_model ?? current.openai_model,
        input.min_salary_idr ?? current.min_salary_idr,
        input.include_negotiable_salary !== undefined
          ? input.include_negotiable_salary
            ? 1
            : 0
          : current.include_negotiable_salary
            ? 1
            : 0,
        JSON.stringify(input.target_locations ?? current.target_locations),
        JSON.stringify(input.target_positions ?? current.target_positions),
        JSON.stringify(input.work_arrangements ?? current.work_arrangements),
        JSON.stringify(input.experience_levels ?? current.experience_levels),
        input.min_match_score ?? current.min_match_score,
        input.preferred_cv_id !== undefined ? input.preferred_cv_id : current.preferred_cv_id,
        input.approval_mode !== undefined
          ? input.approval_mode
            ? 1
            : 0
          : current.approval_mode
            ? 1
            : 0,
        input.baseline_profile ?? current.baseline_profile
      );

      if (input.preferred_cv_id !== undefined) {
        db.prepare('UPDATE cv_profiles SET is_primary = 0').run();
        if (input.preferred_cv_id !== null) {
          db.prepare('UPDATE cv_profiles SET is_primary = 1 WHERE id = ?').run(input.preferred_cv_id);
        }
      }
    });
    tx();

    res.json({
      settings: getSettingsRecord(),
      aiReadiness: getAiReadiness(),
    });
  } catch (err) {
    console.error('[PATCH /api/settings]', sanitizeLogError(err));
    res.status(500).json({ error: 'Failed to update settings.' });
  }
});

export default router;
