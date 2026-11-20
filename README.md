# Glints AI Job Assistant

A standalone, locally hosted full-stack web application designed to assist a cybersecurity professional in Jakarta, Indonesia with job vacancy evaluation, CV version management, AI compatibility scoring, customized cover-letter drafting, and explicit human-in-the-loop application approval.

## Architecture Overview

- **Frontend**: React 19, Vite, TypeScript, Tailwind CSS v4
- **Backend**: Node.js 22, Express.js (`server.ts` + `server/`)
- **Database**: Persistent SQLite via `better-sqlite3` (`./data/applications.db`) with schema migrations
- **AI Integration**: Server-side OpenAI API (`OPENAI_API_KEY`) with automatic server-side Gemini fallback (`GEMINI_API_KEY`)
- **Security**: `helmet` security headers, `express-rate-limit`, Zod payload validation, strict PDF/DOCX MIME + magic-byte upload checks, path traversal defense, localhost-by-default binding, and redacted error logging

## Project Structure

- `server.ts` — Express + Vite middleware / production static entrypoint
- `server/database.ts` — SQLite initialization, migrations, and default Jakarta cybersecurity settings
- `server/middleware/security.ts` — Security headers, rate limiters, optional non-localhost auth guard, path sanitizer
- `server/services/` — `aiProvider.ts`, `jobMatcher.ts`, `coverLetter.ts`, `cvParser.ts`
- `server/routes/` — `dashboard.ts`, `jobs.ts`, `applications.ts`, `cv.ts`, `settings.ts`
- `src/` — React SPA (`DashboardPage`, `JobsPage`, `ApprovalQueuePage`, `ApplicationsPage`, `CvManagerPage`, `SettingsPage`, `ImportJobModal`)
- `scripts/glints-ai-assistant.service` — Ubuntu 26.04 LTS `systemd` service unit (port `3080`)
- `scripts/open-vacancy.mjs` — Optional user-initiated local Playwright helper for opening approved vacancies

## Compliance & Approval Mode

- **Human-in-the-Loop Approval**: Every prepared application enters `PENDING_APPROVAL`. Approval Mode blocks marking an application `SUBMITTED` until explicitly approved (`POST /api/applications/:id/approve`).
- **Glints Terms Compliance**: No unauthorized scraping, CAPTCHA bypass, or automated unattended submission. Users paste/import vacancy details manually or via authorized feeds and complete final submission directly on Glints.

## Installation & Local Startup (Linux Mint 22 MATE / Ubuntu 24.04 / 26.04)

### Prerequisites (Important for Linux Mint 22)

Linux Mint 22 is based on Ubuntu 24.04 LTS, whose default `apt` repository ships **Node.js 18**, which is incompatible with `better-sqlite3@13`, `vite@8`, `openai@7`, and `@google/genai@3` (**Node.js >= 22.12.0** required; **>= 22.18.0** recommended for `node server.ts`).

Install Node.js 22 LTS and native build tools before running `npm install`:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential python3
node -v   # Should print v22.x.x
npm -v    # Should print 10.x.x
```

1. **Install dependencies**:
   ```bash
   rm -rf node_modules
   npm install
   npm run doctor
   ```

2. **Configure environment variables**:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set your backend credentials:
   ```env
   PORT=3080
   HOST=127.0.0.1
   NODE_ENV=production
   OPENAI_API_KEY=your_openai_api_key_here
   OPENAI_MODEL=gpt-4o-mini
   DATABASE_PATH=./data/applications.db
   ```
   Never commit `.env`, `data/`, or `uploads/` to Git.

3. **Run in development**:
   ```bash
   npm run dev
   ```

4. **Build and run in production**:
   ```bash
   npm run build
   npm run start
   ```
   Access locally at `http://127.0.0.1:3080`.

## Ubuntu `systemd` Service Setup

1. Copy the unit file and adjust paths if your install directory differs from `/home/sifulbahri/glints-ai-assistant`:
   ```bash
   sudo cp scripts/glints-ai-assistant.service /etc/systemd/system/glints-ai-assistant.service
   sudo systemctl daemon-reload
   sudo systemctl enable --now glints-ai-assistant
   ```

2. Check service status and logs:
   ```bash
   sudo systemctl status glints-ai-assistant
   journalctl -u glints-ai-assistant -f
   ```

## REST API Endpoints

- `GET /api/health` — Database & backend AI readiness health check
- `GET /api/dashboard` — KPIs, match score distribution, pipeline counts, activity series
- `GET /api/jobs`, `POST /api/jobs`, `GET /api/jobs/:id`, `PATCH /api/jobs/:id`, `DELETE /api/jobs/:id`
- `POST /api/jobs/:id/analyze` — 9-dimension AI suitability scoring & gap analysis
- `GET /api/applications`, `POST /api/applications`, `GET /api/applications/:id`
- `POST /api/applications/:id/cover-letter`, `PATCH /api/applications/:id/cover-letter`
- `PATCH /api/applications/:id/cv`, `PATCH /api/applications/:id/status`
- `POST /api/applications/:id/approve`, `POST /api/applications/:id/reject`
- `GET /api/cv`, `POST /api/cv/upload`, `PATCH /api/cv/:id/primary`, `POST /api/cv/:id/recommendations`, `DELETE /api/cv/:id`
- `GET /api/settings`, `PATCH /api/settings`
