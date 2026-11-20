import { Router } from 'express';
import { getDb, getSettingsRecord } from '../database.ts';
import { sanitizeLogError } from '../middleware/security.ts';

const router = Router();

router.get('/', (_req, res) => {
  try {
    const db = getDb();
    const settings = getSettingsRecord();

    const totalJobs = (db.prepare('SELECT COUNT(*) AS cnt FROM jobs').get() as { cnt: number }).cnt;

    const awaitingAnalysis = (
      db
        .prepare(
          `SELECT COUNT(*) AS cnt FROM jobs j
           WHERE NOT EXISTS (SELECT 1 FROM job_analysis ja WHERE ja.job_id = j.id)`
        )
        .get() as { cnt: number }
    ).cnt;

    const matchingProfile = (
      db
        .prepare(
          `SELECT COUNT(*) AS cnt FROM (
             SELECT ja.suitability_score
             FROM jobs j
             JOIN job_analysis ja ON ja.id = (
               SELECT id FROM job_analysis WHERE job_id = j.id ORDER BY created_at DESC, id DESC LIMIT 1
             )
             WHERE ja.suitability_score >= ?
           )`
        )
        .get(settings.min_match_score) as { cnt: number }
    ).cnt;

    const statusCountsRows = db
      .prepare('SELECT status, COUNT(*) AS cnt FROM applications GROUP BY status')
      .all() as Array<{ status: string; cnt: number }>;

    const statusCounts: Record<string, number> = {
      DISCOVERED: 0,
      ANALYZED: 0,
      PREPARED: 0,
      PENDING_APPROVAL: 0,
      APPROVED: 0,
      SUBMITTED: 0,
      INTERVIEW: 0,
      REJECTED: 0,
      WITHDRAWN: 0,
    };
    for (const row of statusCountsRows) {
      statusCounts[row.status] = row.cnt;
    }

    const awaitingApproval = statusCounts.PENDING_APPROVAL;
    const submittedCount = statusCounts.SUBMITTED;
    const interviewCount = statusCounts.INTERVIEW;
    const rejectedCount = statusCounts.REJECTED;

    // Success rate: interviews / (submitted + interviews + post-submission rejections)
    const totalOutcomePool = submittedCount + interviewCount + rejectedCount;
    const successRate =
      totalOutcomePool > 0 ? Math.round(((interviewCount) / totalOutcomePool) * 100) : 0;

    // Match score distribution across analyzed jobs
    const analyzedScores = db
      .prepare(
        `SELECT ja.suitability_score
         FROM jobs j
         JOIN job_analysis ja ON ja.id = (
           SELECT id FROM job_analysis WHERE job_id = j.id ORDER BY created_at DESC, id DESC LIMIT 1
         )`
      )
      .all() as Array<{ suitability_score: number }>;

    const matchDistribution = [
      { label: 'Excellent (85–100)', range: '85-100', count: 0 },
      { label: 'Good (70–84)', range: '70-84', count: 0 },
      { label: 'Moderate (50–69)', range: '50-69', count: 0 },
      { label: 'Low (<50)', range: '0-49', count: 0 },
    ];
    for (const r of analyzedScores) {
      if (r.suitability_score >= 85) matchDistribution[0].count += 1;
      else if (r.suitability_score >= 70) matchDistribution[1].count += 1;
      else if (r.suitability_score >= 50) matchDistribution[2].count += 1;
      else matchDistribution[3].count += 1;
    }

    // Recent 14-day activity (jobs imported + applications updated)
    const activityRows = db
      .prepare(
        `SELECT date(created_at) AS day, COUNT(*) AS jobs_added
         FROM jobs
         WHERE created_at >= datetime('now', '-14 days')
         GROUP BY date(created_at)
         ORDER BY day ASC`
      )
      .all() as Array<{ day: string; jobs_added: number }>;

    const appActivityRows = db
      .prepare(
        `SELECT date(created_at) AS day, COUNT(*) AS events
         FROM application_history
         WHERE created_at >= datetime('now', '-14 days')
         GROUP BY date(created_at)
         ORDER BY day ASC`
      )
      .all() as Array<{ day: string; events: number }>;

    const activityMap = new Map<string, { day: string; jobs: number; actions: number }>();
    for (const r of activityRows) {
      activityMap.set(r.day, { day: r.day, jobs: r.jobs_added, actions: 0 });
    }
    for (const r of appActivityRows) {
      const existing = activityMap.get(r.day) || { day: r.day, jobs: 0, actions: 0 };
      existing.actions = r.events;
      activityMap.set(r.day, existing);
    }

    const activitySeries = Array.from(activityMap.values()).sort((a, b) =>
      a.day.localeCompare(b.day)
    );

    const upcomingFollowUps = db
      .prepare(
        `SELECT a.id, a.status, a.follow_up_date, j.title AS job_title, j.company
         FROM applications a
         JOIN jobs j ON j.id = a.job_id
         WHERE a.follow_up_date IS NOT NULL AND a.follow_up_date != ''
           AND a.status NOT IN ('REJECTED', 'WITHDRAWN')
         ORDER BY a.follow_up_date ASC
         LIMIT 6`
      )
      .all();

    const recentHistory = db
      .prepare(
        `SELECT h.id, h.application_id, h.to_status, h.action, h.note, h.created_at,
          j.title AS job_title, j.company
         FROM application_history h
         JOIN applications a ON a.id = h.application_id
         JOIN jobs j ON j.id = a.job_id
         ORDER BY h.created_at DESC, h.id DESC
         LIMIT 8`
      )
      .all();

    res.json({
      kpis: {
        totalDiscoveredJobs: totalJobs,
        awaitingAnalysis,
        matchingProfile,
        awaitingApproval,
        submitted: submittedCount,
        interviews: interviewCount,
        rejections: rejectedCount,
        successRate,
      },
      statusCounts,
      matchDistribution,
      activitySeries,
      upcomingFollowUps,
      recentHistory,
    });
  } catch (err) {
    console.error('[GET /api/dashboard]', sanitizeLogError(err));
    res.status(500).json({ error: 'Failed to load dashboard metrics.' });
  }
});

export default router;
