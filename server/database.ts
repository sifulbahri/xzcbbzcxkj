import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { UserSettings, WorkArrangement } from './types.ts';

const DEFAULT_BASELINE_PROFILE = [
  'More than three years of cybersecurity and network security experience.',
  'Experience with Fortinet and Palo Alto Networks firewalls.',
  'Network security implementation and troubleshooting.',
  'VPN, NAT, IDS/IPS, and NGFW.',
  'SIEM and security monitoring.',
  'Wazuh, ELK, OpenSearch, and Suricata.',
  'Security implementation, technical presales, and solution consulting.',
  'ISO 27001 and NIST familiarity.',
  'Low-Level Design (LLD), User Acceptance Testing (UAT), and technical documentation.',
].join('\n');

const DEFAULT_TARGET_POSITIONS = [
  'Cybersecurity Engineer',
  'IT Security Engineer',
  'Network Security Engineer',
  'Security Analyst',
  'IT GRC Specialist',
  'Solution Consultant',
  'Security Presales Engineer',
];

const DEFAULT_LOCATIONS = ['Jakarta, Indonesia'];
const DEFAULT_WORK_ARRANGEMENTS: WorkArrangement[] = ['On-site', 'Hybrid', 'Remote'];
const DEFAULT_EXPERIENCE_LEVELS = ['Junior-Mid Level', 'Mid Level'];

let dbInstance: Database.Database | null = null;

export function resolveDbPath(): string {
  const configured = process.env.DATABASE_PATH?.trim() || './data/applications.db';
  return path.resolve(process.cwd(), configured);
}

export function getDb(): Database.Database {
  if (!dbInstance) {
    return initDatabase();
  }
  return dbInstance;
}

export function initDatabase(): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = resolveDbPath();
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const uploadsDir = path.resolve(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);
  seedDefaultSettings(db);

  dbInstance = db;
  return db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set<number>(
    db
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => (row as { version: number }).version)
  );

  const migrations: Array<{ version: number; name: string; sql: string }> = [
    {
      version: 1,
      name: 'initial_schema',
      sql: `
        CREATE TABLE IF NOT EXISTS user_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          ai_provider TEXT NOT NULL DEFAULT 'auto',
          openai_model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
          min_salary_idr INTEGER NOT NULL DEFAULT 8000000,
          include_negotiable_salary INTEGER NOT NULL DEFAULT 1,
          target_locations TEXT NOT NULL,
          target_positions TEXT NOT NULL,
          work_arrangements TEXT NOT NULL,
          experience_levels TEXT NOT NULL,
          min_match_score INTEGER NOT NULL DEFAULT 70,
          preferred_cv_id INTEGER NULL,
          approval_mode INTEGER NOT NULL DEFAULT 1,
          baseline_profile TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS cv_profiles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          original_filename TEXT NOT NULL,
          stored_filename TEXT NOT NULL UNIQUE,
          mime_type TEXT NOT NULL,
          file_size INTEGER NOT NULL,
          extracted_text TEXT NOT NULL,
          is_primary INTEGER NOT NULL DEFAULT 0,
          ai_recommendations TEXT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          company TEXT NOT NULL,
          location TEXT NOT NULL,
          work_arrangement TEXT NOT NULL DEFAULT 'On-site',
          employment_type TEXT NOT NULL DEFAULT 'Full-time',
          experience_level TEXT NOT NULL DEFAULT 'Mid Level',
          salary_min_idr INTEGER NULL,
          salary_max_idr INTEGER NULL,
          salary_text TEXT NOT NULL DEFAULT 'Undisclosed / Negotiable',
          salary_negotiable INTEGER NOT NULL DEFAULT 1,
          source TEXT NOT NULL DEFAULT 'Glints Manual Import',
          vacancy_url TEXT NOT NULL,
          normalized_url TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'DISCOVERED',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_jobs_company_title ON jobs(LOWER(company), LOWER(title));
        CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

        CREATE TABLE IF NOT EXISTS job_analysis (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
          cv_id INTEGER NULL REFERENCES cv_profiles(id) ON DELETE SET NULL,
          suitability_score INTEGER NOT NULL,
          classification TEXT NOT NULL,
          technical_skills_json TEXT NOT NULL,
          work_experience_json TEXT NOT NULL,
          education_json TEXT NOT NULL,
          certifications_json TEXT NOT NULL,
          seniority_json TEXT NOT NULL,
          location_json TEXT NOT NULL,
          salary_json TEXT NOT NULL,
          responsibilities_summary TEXT NOT NULL,
          skill_gaps_json TEXT NOT NULL,
          strengths_json TEXT NOT NULL,
          overall_explanation TEXT NOT NULL,
          model_used TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_job_analysis_job_id ON job_analysis(job_id);

        CREATE TABLE IF NOT EXISTS applications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          job_id INTEGER NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
          cv_id INTEGER NULL REFERENCES cv_profiles(id) ON DELETE SET NULL,
          analysis_id INTEGER NULL REFERENCES job_analysis(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
          match_score INTEGER NULL,
          cover_letter TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          follow_up_date TEXT NULL,
          approved_at TEXT NULL,
          rejected_at TEXT NULL,
          rejection_reason TEXT NULL,
          submitted_at TEXT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);

        CREATE TABLE IF NOT EXISTS application_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
          from_status TEXT NULL,
          to_status TEXT NOT NULL,
          action TEXT NOT NULL,
          note TEXT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_application_history_app_id ON application_history(application_id);

        CREATE TABLE IF NOT EXISTS generated_documents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
          job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
          cv_id INTEGER NULL REFERENCES cv_profiles(id) ON DELETE SET NULL,
          doc_type TEXT NOT NULL DEFAULT 'cover_letter',
          content TEXT NOT NULL,
          model_used TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `,
    },
  ];

  for (const migration of migrations) {
    if (!applied.has(migration.version)) {
      const tx = db.transaction(() => {
        db.exec(migration.sql);
        db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(
          migration.version,
          migration.name
        );
      });
      tx();
    }
  }
}

function seedDefaultSettings(db: Database.Database): void {
  const existing = db.prepare('SELECT id FROM user_settings WHERE id = 1').get();
  if (!existing) {
    db.prepare(
      `INSERT INTO user_settings (
        id, ai_provider, openai_model, min_salary_idr, include_negotiable_salary,
        target_locations, target_positions, work_arrangements, experience_levels,
        min_match_score, preferred_cv_id, approval_mode, baseline_profile
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
    ).run(
      'auto',
      process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
      8000000,
      1,
      JSON.stringify(DEFAULT_LOCATIONS),
      JSON.stringify(DEFAULT_TARGET_POSITIONS),
      JSON.stringify(DEFAULT_WORK_ARRANGEMENTS),
      JSON.stringify(DEFAULT_EXPERIENCE_LEVELS),
      70,
      1,
      DEFAULT_BASELINE_PROFILE
    );
  }
}

export function getSettingsRecord(): UserSettings {
  const db = getDb();
  const row = db.prepare('SELECT * FROM user_settings WHERE id = 1').get() as Record<string, unknown>;
  return {
    id: Number(row.id),
    ai_provider: (row.ai_provider as 'auto' | 'openai' | 'gemini') || 'auto',
    openai_model: String(row.openai_model || 'gpt-4o-mini'),
    min_salary_idr: Number(row.min_salary_idr ?? 8000000),
    include_negotiable_salary: Boolean(row.include_negotiable_salary),
    target_locations: JSON.parse(String(row.target_locations || '[]')) as string[],
    target_positions: JSON.parse(String(row.target_positions || '[]')) as string[],
    work_arrangements: JSON.parse(String(row.work_arrangements || '[]')) as WorkArrangement[],
    experience_levels: JSON.parse(String(row.experience_levels || '[]')) as string[],
    min_match_score: Number(row.min_match_score ?? 70),
    preferred_cv_id: row.preferred_cv_id !== null ? Number(row.preferred_cv_id) : null,
    approval_mode: Boolean(row.approval_mode),
    baseline_profile: String(row.baseline_profile || DEFAULT_BASELINE_PROFILE),
    updated_at: String(row.updated_at || ''),
  };
}
