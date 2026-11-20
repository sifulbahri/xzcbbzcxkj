import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../database.ts';
import { aiRateLimiter, sanitizeLogError } from '../middleware/security.ts';
import { analyzeJobVacancy, mapAnalysisRow } from '../services/jobMatcher.ts';
import {
  buildJobStreetPageUrl,
  extractJobStreetListings,
  isCloudflareChallengeHtml,
  type ExtractedJobStreetListing,
} from '../services/jobstreetParser.ts';
import type { JobRecord, WorkArrangement } from '../types.ts';

const router = Router();

const createJobSchema = z.object({
  title: z.string().trim().min(2, 'Position title is required').max(200),
  company: z.string().trim().min(2, 'Company name is required').max(200),
  location: z.string().trim().min(2).max(160).default('Jakarta, Indonesia'),
  work_arrangement: z.enum(['On-site', 'Hybrid', 'Remote']).default('On-site'),
  employment_type: z.string().trim().min(2).max(80).default('Full-time'),
  experience_level: z.string().trim().min(2).max(80).default('Mid Level'),
  salary_min_idr: z.number().int().nonnegative().nullable().optional(),
  salary_max_idr: z.number().int().nonnegative().nullable().optional(),
  salary_text: z.string().trim().max(120).optional(),
  salary_negotiable: z.boolean().default(true),
  source: z.string().trim().max(100).default('Glints Manual Import'),
  vacancy_url: z
    .string()
    .trim()
    .url('Please provide a valid vacancy URL (e.g., https://glints.com/...)')
    .refine(
      (u) => u.startsWith('http://') || u.startsWith('https://'),
      'Vacancy URL must use http:// or https://'
    ),
  description: z.string().trim().min(20, 'Please paste the job description (at least 20 characters)').max(50000),
});

const updateJobSchema = createJobSchema.partial();

export function normalizeVacancyUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl.trim());
    parsed.hash = '';
    // Strip common tracking query params while preserving job IDs
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref'];
    for (const key of trackingParams) {
      parsed.searchParams.delete(key);
    }
    const cleaned = parsed.toString().replace(/\/+$/, '');
    return cleaned.toLowerCase();
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}

export function mapJobRow(row: Record<string, unknown>): JobRecord {
  return {
    id: Number(row.id),
    title: String(row.title),
    company: String(row.company),
    location: String(row.location),
    work_arrangement: String(row.work_arrangement) as WorkArrangement,
    employment_type: String(row.employment_type),
    experience_level: String(row.experience_level),
    salary_min_idr: row.salary_min_idr !== null && row.salary_min_idr !== undefined ? Number(row.salary_min_idr) : null,
    salary_max_idr: row.salary_max_idr !== null && row.salary_max_idr !== undefined ? Number(row.salary_max_idr) : null,
    salary_text: String(row.salary_text),
    salary_negotiable: Boolean(row.salary_negotiable),
    source: String(row.source),
    vacancy_url: String(row.vacancy_url),
    description: String(row.description),
    status: String(row.status) as JobRecord['status'],
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    latest_score:
      row.latest_score !== null && row.latest_score !== undefined ? Number(row.latest_score) : null,
    latest_classification: row.latest_classification
      ? (String(row.latest_classification) as JobRecord['latest_classification'])
      : null,
    application_id:
      row.application_id !== null && row.application_id !== undefined ? Number(row.application_id) : null,
    application_status: row.application_status
      ? (String(row.application_status) as JobRecord['application_status'])
      : null,
  };
}

router.get('/', (req, res) => {
  try {
    const db = getDb();
    const search = String(req.query.search || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim();
    const arrangement = String(req.query.arrangement || '').trim();
    const minScoreParam = req.query.minScore ? Number(req.query.minScore) : null;

    const rows = db
      .prepare(
        `SELECT j.*,
          ja.suitability_score AS latest_score,
          ja.classification AS latest_classification,
          a.id AS application_id,
          a.status AS application_status
        FROM jobs j
        LEFT JOIN job_analysis ja ON ja.id = (
          SELECT id FROM job_analysis WHERE job_id = j.id ORDER BY created_at DESC, id DESC LIMIT 1
        )
        LEFT JOIN applications a ON a.job_id = j.id
        ORDER BY j.created_at DESC, j.id DESC`
      )
      .all() as Array<Record<string, unknown>>;

    let jobs = rows.map(mapJobRow);

    if (search) {
      jobs = jobs.filter(
        (j) =>
          j.title.toLowerCase().includes(search) ||
          j.company.toLowerCase().includes(search) ||
          j.location.toLowerCase().includes(search) ||
          j.description.toLowerCase().includes(search)
      );
    }

    if (status && status !== 'ALL') {
      jobs = jobs.filter((j) => (j.application_status || j.status) === status);
    }

    if (arrangement && arrangement !== 'ALL') {
      jobs = jobs.filter((j) => j.work_arrangement === arrangement);
    }

    if (minScoreParam !== null && !Number.isNaN(minScoreParam) && minScoreParam > 0) {
      jobs = jobs.filter((j) => (j.latest_score ?? -1) >= minScoreParam);
    }

    res.json({ jobs });
  } catch (err) {
    console.error('[GET /api/jobs]', sanitizeLogError(err));
    res.status(500).json({ error: 'Failed to load jobs.' });
  }
});

router.post('/', (req, res) => {
  try {
    const parsed = createJobSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid job payload.',
        issues: parsed.error.issues,
      });
      return;
    }

    const input = parsed.data;
    const normalizedUrl = normalizeVacancyUrl(input.vacancy_url);
    const db = getDb();

    const dupByUrl = db
      .prepare('SELECT id, title, company FROM jobs WHERE normalized_url = ?')
      .get(normalizedUrl) as { id: number; title: string; company: string } | undefined;

    if (dupByUrl) {
      res.status(409).json({
        error: `Duplicate vacancy URL detected: already saved as "${dupByUrl.title}" at ${dupByUrl.company}.`,
        existingJobId: dupByUrl.id,
      });
      return;
    }

    const dupByCompanyTitle = db
      .prepare(
        'SELECT id, title, company FROM jobs WHERE LOWER(TRIM(company)) = LOWER(TRIM(?)) AND LOWER(TRIM(title)) = LOWER(TRIM(?))'
      )
      .get(input.company, input.title) as { id: number; title: string; company: string } | undefined;

    if (dupByCompanyTitle) {
      res.status(409).json({
        error: `Duplicate vacancy detected: "${dupByCompanyTitle.title}" at ${dupByCompanyTitle.company} is already in your workspace.`,
        existingJobId: dupByCompanyTitle.id,
      });
      return;
    }

    let computedSalaryText = input.salary_text?.trim() || '';
    if (!computedSalaryText) {
      if (input.salary_min_idr && input.salary_max_idr) {
        computedSalaryText = `IDR ${input.salary_min_idr.toLocaleString('en-US')} - ${input.salary_max_idr.toLocaleString('en-US')}`;
      } else if (input.salary_min_idr) {
        computedSalaryText = `From IDR ${input.salary_min_idr.toLocaleString('en-US')}`;
      } else {
        computedSalaryText = input.salary_negotiable
          ? 'Negotiable / Undisclosed'
          : 'Not specified';
      }
    }

    const result = db
      .prepare(
        `INSERT INTO jobs (
          title, company, location, work_arrangement, employment_type,
          experience_level, salary_min_idr, salary_max_idr, salary_text,
          salary_negotiable, source, vacancy_url, normalized_url, description, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DISCOVERED')`
      )
      .run(
        input.title,
        input.company,
        input.location,
        input.work_arrangement,
        input.employment_type,
        input.experience_level,
        input.salary_min_idr ?? null,
        input.salary_max_idr ?? null,
        computedSalaryText,
        input.salary_negotiable ? 1 : 0,
        input.source,
        input.vacancy_url,
        normalizedUrl,
        input.description
      );

    const created = db
      .prepare('SELECT * FROM jobs WHERE id = ?')
      .get(result.lastInsertRowid) as Record<string, unknown>;

    res.status(201).json({ job: mapJobRow(created) });
  } catch (err) {
    console.error('[POST /api/jobs]', sanitizeLogError(err));
    res.status(500).json({ error: 'Failed to create job record.' });
  }
});

const bulkJobItemSchema = z.object({
  vacancy_url: z
    .string()
    .trim()
    .url('Invalid vacancy URL')
    .refine(
      (u) => u.startsWith('http://') || u.startsWith('https://'),
      'Vacancy URL must use http:// or https://'
    ),
  title: z.string().trim().max(200).optional(),
  company: z.string().trim().max(200).optional(),
  location: z.string().trim().max(160).optional(),
  work_arrangement: z.enum(['On-site', 'Hybrid', 'Remote']).optional(),
  employment_type: z.string().trim().max(80).optional(),
  experience_level: z.string().trim().max(80).optional(),
  salary_min_idr: z.number().int().nonnegative().nullable().optional(),
  salary_max_idr: z.number().int().nonnegative().nullable().optional(),
  salary_text: z.string().trim().max(120).optional(),
  salary_negotiable: z.boolean().optional(),
  source: z.string().trim().max(100).optional(),
  description: z.string().trim().max(50000).optional(),
});

const bulkImportSchema = z.object({
  items: z.array(bulkJobItemSchema).min(1, 'At least one vacancy URL is required').max(200, 'Maximum 200 URLs per batch file'),
});

function deriveTitleFromUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const segments = parsed.pathname
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean);
    const meaningful = segments.filter(
      (seg) =>
        !/^(id|en|opportunities|jobs|job|view|detail|vacancies|karir)$/i.test(seg) &&
        !/^[0-9a-f-]{8,}$/i.test(seg) &&
        !/^\d+$/.test(seg)
    );
    const candidate = meaningful[meaningful.length - 1];
    if (candidate && candidate.length >= 3) {
      const cleaned = decodeURIComponent(candidate)
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleaned.length >= 3) {
        return cleaned.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 120);
      }
    }
  } catch {
    // fallback below
  }
  return 'Imported Vacancy (Pending Details)';
}

router.post('/bulk', (req, res) => {
  try {
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (rawItems.length === 0) {
      res.status(400).json({ error: 'No vacancy items provided for batch import.' });
      return;
    }
    if (rawItems.length > 200) {
      res.status(400).json({ error: 'Batch import is limited to 200 URLs per file.' });
      return;
    }

    const db = getDb();
    const created: JobRecord[] = [];
    const skippedDuplicates: Array<{ vacancy_url: string; reason: string }> = [];
    const failed: Array<{ vacancy_url: string; reason: string }> = [];
    const seenUrlsInBatch = new Set<string>();

    const checkUrlStmt = db.prepare('SELECT id, title, company FROM jobs WHERE normalized_url = ?');
    const checkCompanyTitleStmt = db.prepare(
      'SELECT id, title, company FROM jobs WHERE LOWER(TRIM(company)) = LOWER(TRIM(?)) AND LOWER(TRIM(title)) = LOWER(TRIM(?))'
    );
    const insertStmt = db.prepare(
      `INSERT INTO jobs (
        title, company, location, work_arrangement, employment_type,
        experience_level, salary_min_idr, salary_max_idr, salary_text,
        salary_negotiable, source, vacancy_url, normalized_url, description, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DISCOVERED')`
    );
    const selectByIdStmt = db.prepare('SELECT * FROM jobs WHERE id = ?');

    const runBatch = db.transaction(() => {
      for (const raw of rawItems) {
        const parsedItem = bulkJobItemSchema.safeParse(raw);
        if (!parsedItem.success) {
          const urlDisplay = typeof raw?.vacancy_url === 'string' ? raw.vacancy_url : '(missing URL)';
          failed.push({
            vacancy_url: urlDisplay,
            reason: parsedItem.error.issues[0]?.message || 'Invalid vacancy entry',
          });
          continue;
        }

        const item = parsedItem.data;
        const normalizedUrl = normalizeVacancyUrl(item.vacancy_url);

        if (seenUrlsInBatch.has(normalizedUrl)) {
          skippedDuplicates.push({
            vacancy_url: item.vacancy_url,
            reason: 'Duplicate URL within uploaded file',
          });
          continue;
        }
        seenUrlsInBatch.add(normalizedUrl);

        const dupByUrl = checkUrlStmt.get(normalizedUrl) as
          | { id: number; title: string; company: string }
          | undefined;
        if (dupByUrl) {
          skippedDuplicates.push({
            vacancy_url: item.vacancy_url,
            reason: `Already saved as "${dupByUrl.title}" at ${dupByUrl.company}`,
          });
          continue;
        }

        const title = item.title && item.title.length >= 2 ? item.title : deriveTitleFromUrl(item.vacancy_url);
        const company =
          item.company && item.company.length >= 2 ? item.company : 'Pending Company Details';

        if (company !== 'Pending Company Details') {
          const dupByCT = checkCompanyTitleStmt.get(company, title) as
            | { id: number; title: string; company: string }
            | undefined;
          if (dupByCT) {
            skippedDuplicates.push({
              vacancy_url: item.vacancy_url,
              reason: `Duplicate role "${dupByCT.title}" at ${dupByCT.company}`,
            });
            continue;
          }
        }

        const salaryMin = item.salary_min_idr ?? null;
        const salaryMax = item.salary_max_idr ?? null;
        const salaryNegotiable = item.salary_negotiable ?? true;
        let salaryText = item.salary_text?.trim() || '';
        if (!salaryText) {
          if (salaryMin && salaryMax) {
            salaryText = `IDR ${salaryMin.toLocaleString('en-US')} - ${salaryMax.toLocaleString('en-US')}`;
          } else if (salaryMin) {
            salaryText = `From IDR ${salaryMin.toLocaleString('en-US')}`;
          } else {
            salaryText = salaryNegotiable ? 'Negotiable / Undisclosed' : 'Not specified';
          }
        }

        const description =
          item.description && item.description.length >= 20
            ? item.description
            : 'Imported via batch URL file. Open job details and paste the full job description before running AI analysis.';

        const result = insertStmt.run(
          title,
          company,
          item.location && item.location.length >= 2 ? item.location : 'Jakarta, Indonesia',
          item.work_arrangement ?? 'Hybrid',
          item.employment_type && item.employment_type.length >= 2 ? item.employment_type : 'Full-time',
          item.experience_level && item.experience_level.length >= 2 ? item.experience_level : 'Mid Level',
          salaryMin,
          salaryMax,
          salaryText,
          salaryNegotiable ? 1 : 0,
          item.source && item.source.length >= 2 ? item.source : 'Batch URL File Import',
          item.vacancy_url,
          normalizedUrl,
          description
        );

        const row = selectByIdStmt.get(result.lastInsertRowid) as Record<string, unknown>;
        created.push(mapJobRow(row));
      }
    });

    runBatch();

    // Ensure bulkImportSchema stays referenced for strict validation shape parity
    void bulkImportSchema;

    res.status(created.length > 0 ? 201 : 200).json({
      created,
      skippedDuplicates,
      failed,
    });
  } catch (err) {
    console.error('[POST /api/jobs/bulk]', sanitizeLogError(err));
    res.status(500).json({ error: 'Failed to process batch vacancy import.' });
  }
});

const scrapeJobStreetSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .url('Please enter a valid JobStreet URL')
    .refine((raw) => {
      try {
        const u = new URL(raw);
        return (
          (u.protocol === 'https:' || u.protocol === 'http:') &&
          (u.hostname === 'id.jobstreet.com' ||
            u.hostname.endsWith('.jobstreet.com') ||
            u.hostname.endsWith('.jobstreet.co.id'))
        );
      } catch {
        return false;
      }
    }, 'Only JobStreet URLs (e.g. https://id.jobstreet.com/...) are allowed.'),
  startPage: z.number().int().min(1).max(100).default(2),
  endPage: z.number().int().min(1).max(100).default(20),
});

router.post('/scrape-jobstreet', async (req, res) => {
  try {
    const parsed = scrapeJobStreetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid JobStreet scrape configuration.',
      });
      return;
    }

    const { baseUrl, startPage, endPage } = parsed.data;
    if (endPage < startPage) {
      res.status(400).json({ error: 'End page must be greater than or equal to start page.' });
      return;
    }
    if (endPage - startPage + 1 > 25) {
      res.status(400).json({ error: 'Maximum 25 pages can be scraped per request.' });
      return;
    }

    const allListings: ExtractedJobStreetListing[] = [];
    const seenUrls = new Set<string>();
    let pagesScanned = 0;
    let blockedByAntiBot = false;
    let blockStatusCode: number | null = null;

    for (let page = startPage; page <= endPage; page++) {
      const pageUrl = buildJobStreetPageUrl(baseUrl, page);
      const response = await fetch(pageUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        signal: AbortSignal.timeout(12000),
      });

      const html = await response.text();
      pagesScanned += 1;

      if (response.status === 403 || response.status === 429 || isCloudflareChallengeHtml(html)) {
        blockedByAntiBot = true;
        blockStatusCode = response.status;
        break;
      }

      if (!response.ok) {
        break;
      }

      const extracted = extractJobStreetListings(html, page);
      for (const item of extracted) {
        const key = normalizeVacancyUrl(item.vacancy_url);
        if (!seenUrls.has(key)) {
          seenUrls.add(key);
          allListings.push(item);
        }
      }

      if (page < endPage) {
        await new Promise((r) => setTimeout(r, 350));
      }
    }

    res.json({
      listings: allListings,
      pagesScanned,
      blockedByAntiBot,
      statusCode: blockStatusCode,
      message: blockedByAntiBot
        ? `JobStreet returned an anti-bot challenge (HTTP ${blockStatusCode ?? 403}) to automated server requests. Use the Saved HTML / Page Source extractor below or run "node scripts/capture-jobstreet.mjs" in your local browser.`
        : allListings.length > 0
          ? `Extracted ${allListings.length} vacancies across ${pagesScanned} page(s).`
          : `Scanned ${pagesScanned} page(s) but found 0 job cards matching JobStreet selectors.`,
    });
  } catch (err) {
    console.error('[POST /api/jobs/scrape-jobstreet]', sanitizeLogError(err));
    res.status(500).json({ error: 'Failed to fetch JobStreet pages.' });
  }
});

const parseHtmlSchema = z.object({
  pages: z
    .array(
      z.object({
        filename: z.string().max(200).optional(),
        html: z.string().min(50).max(5_000_000),
      })
    )
    .min(1)
    .max(25),
});

router.post('/parse-jobstreet-html', (req, res) => {
  try {
    const parsed = parseHtmlSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid HTML payload for JobStreet parser.',
      });
      return;
    }

    const allListings: ExtractedJobStreetListing[] = [];
    const seenUrls = new Set<string>();
    let challengePages = 0;

    parsed.data.pages.forEach((p, idx) => {
      if (isCloudflareChallengeHtml(p.html)) {
        challengePages += 1;
        return;
      }
      const extracted = extractJobStreetListings(p.html, idx + 1);
      for (const item of extracted) {
        const key = normalizeVacancyUrl(item.vacancy_url);
        if (!seenUrls.has(key)) {
          seenUrls.add(key);
          allListings.push(item);
        }
      }
    });

    res.json({
      listings: allListings,
      pagesParsed: parsed.data.pages.length,
      challengePages,
      message:
        allListings.length > 0
          ? `Extracted ${allListings.length} unique vacancies (Job Title, Company Name, Salary Range) from ${parsed.data.pages.length} HTML source(s).`
          : challengePages > 0
            ? 'The provided HTML appears to be a Cloudflare challenge page rather than rendered JobStreet listings.'
            : 'No JobStreet job cards (jobTitle / jobCompany / jobSalary) were detected in the provided HTML.',
    });
  } catch (err) {
    console.error('[POST /api/jobs/parse-jobstreet-html]', sanitizeLogError(err));
    res.status(500).json({ error: 'Failed to parse JobStreet HTML.' });
  }
});

router.get('/:id', (req, res) => {
  try {
    const jobId = Number(req.params.id);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      res.status(400).json({ error: 'Invalid job ID.' });
      return;
    }

    const db = getDb();
    const row = db
      .prepare(
        `SELECT j.*,
          ja.suitability_score AS latest_score,
          ja.classification AS latest_classification,
          a.id AS application_id,
          a.status AS application_status
        FROM jobs j
        LEFT JOIN job_analysis ja ON ja.id = (
          SELECT id FROM job_analysis WHERE job_id = j.id ORDER BY created_at DESC, id DESC LIMIT 1
        )
        LEFT JOIN applications a ON a.job_id = j.id
        WHERE j.id = ?`
      )
      .get(jobId) as Record<string, unknown> | undefined;

    if (!row) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }

    const analysisRows = db
      .prepare('SELECT * FROM job_analysis WHERE job_id = ? ORDER BY created_at DESC, id DESC')
      .all(jobId) as Array<Record<string, unknown>>;

    res.json({
      job: mapJobRow(row),
      latestAnalysis: analysisRows[0] ? mapAnalysisRow(analysisRows[0]) : null,
      analysisHistory: analysisRows.map(mapAnalysisRow),
    });
  } catch (err) {
    console.error('[GET /api/jobs/:id]', sanitizeLogError(err));
    res.status(500).json({ error: 'Failed to load job details.' });
  }
});

router.patch('/:id', (req, res) => {
  try {
    const jobId = Number(req.params.id);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      res.status(400).json({ error: 'Invalid job ID.' });
      return;
    }

    const parsed = updateJobSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid update payload.' });
      return;
    }

    const db = getDb();
    const existing = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }

    const input = parsed.data;
    const nextUrl = input.vacancy_url ?? String(existing.vacancy_url);
    const nextNorm = normalizeVacancyUrl(nextUrl);

    db.prepare(
      `UPDATE jobs SET
        title = ?,
        company = ?,
        location = ?,
        work_arrangement = ?,
        employment_type = ?,
        experience_level = ?,
        salary_min_idr = ?,
        salary_max_idr = ?,
        salary_text = ?,
        salary_negotiable = ?,
        source = ?,
        vacancy_url = ?,
        normalized_url = ?,
        description = ?,
        updated_at = datetime('now')
      WHERE id = ?`
    ).run(
      input.title ?? existing.title,
      input.company ?? existing.company,
      input.location ?? existing.location,
      input.work_arrangement ?? existing.work_arrangement,
      input.employment_type ?? existing.employment_type,
      input.experience_level ?? existing.experience_level,
      input.salary_min_idr !== undefined ? input.salary_min_idr : existing.salary_min_idr,
      input.salary_max_idr !== undefined ? input.salary_max_idr : existing.salary_max_idr,
      input.salary_text ?? existing.salary_text,
      input.salary_negotiable !== undefined
        ? input.salary_negotiable
          ? 1
          : 0
        : existing.salary_negotiable,
      input.source ?? existing.source,
      nextUrl,
      nextNorm,
      input.description ?? existing.description,
      jobId
    );

    const updated = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as Record<
      string,
      unknown
    >;
    res.json({ job: mapJobRow(updated) });
  } catch (err) {
    console.error('[PATCH /api/jobs/:id]', sanitizeLogError(err));
    res.status(500).json({ error: 'Failed to update job.' });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const jobId = Number(req.params.id);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      res.status(400).json({ error: 'Invalid job ID.' });
      return;
    }

    const db = getDb();
    const info = db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
    if (info.changes === 0) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }

    res.json({ deleted: true });
  } catch (err) {
    console.error('[DELETE /api/jobs/:id]', sanitizeLogError(err));
    res.status(500).json({ error: 'Failed to delete job.' });
  }
});

router.post('/:id/analyze', aiRateLimiter, async (req, res) => {
  try {
    const jobId = Number(req.params.id);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      res.status(400).json({ error: 'Invalid job ID.' });
      return;
    }

    const bodySchema = z.object({
      cv_id: z.number().int().positive().nullable().optional(),
    });
    const parsed = bodySchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid analysis request body.' });
      return;
    }

    const db = getDb();
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'Job not found.' });
      return;
    }

    const job = mapJobRow(row);
    const analysis = await analyzeJobVacancy(job, parsed.data.cv_id);

    // Sync match_score on any existing application if present
    db.prepare(
      `UPDATE applications SET analysis_id = ?, match_score = ?, updated_at = datetime('now') WHERE job_id = ?`
    ).run(analysis.id, analysis.suitability_score, jobId);

    res.json({ analysis });
  } catch (err) {
    const msg = sanitizeLogError(err);
    console.error('[POST /api/jobs/:id/analyze]', msg);
    const status = msg.includes('not configured') ? 503 : 500;
    res.status(status).json({ error: msg });
  }
});

export default router;
