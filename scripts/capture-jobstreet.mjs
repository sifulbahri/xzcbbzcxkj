/**
 * User-Attended JobStreet Page Capture Helper (Pages 2-20)
 *
 * Opens a visible Chromium window on your Linux Mint / Ubuntu desktop so you can
 * pass any Cloudflare check normally in your browser, then extracts:
 *   - Job Title
 *   - Company Name
 *   - Salary Range
 *   - Location & Vacancy URL
 * across pages 2 to 20 and writes `jobstreet-pages-2-20.json` ready for the
 * "Multiple URLs (File)" importer (or direct API upload).
 *
 * Usage:
 *   npm install -D playwright && npx playwright install chromium
 *   node scripts/capture-jobstreet.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const BASE_URL =
  process.argv[2] || 'https://id.jobstreet.com/id/security-Engineer-jobs/in-Jakarta-Raya';
const START_PAGE = Number(process.argv[3]) || 2;
const END_PAGE = Number(process.argv[4]) || 20;
const OUT_FILE = path.resolve(process.cwd(), `jobstreet-pages-${START_PAGE}-${END_PAGE}.json`);

async function main() {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    console.error(
      'Playwright is not installed. Run:\n  npm install -D playwright && npx playwright install chromium'
    );
    process.exit(1);
  }

  const browser = await playwright.chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  const collected = [];
  const seenUrls = new Set();

  for (let p = START_PAGE; p <= END_PAGE; p++) {
    const url = new URL(BASE_URL);
    url.searchParams.set('page', String(p));
    console.log(`[Page ${p}/${END_PAGE}] Navigating to ${url.toString()}`);

    await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });

    // Wait for JobStreet job cards to render (gives user time if Cloudflare check appears)
    await page.waitForSelector('article [data-automation="jobTitle"]', { timeout: 60000 }).catch(() => null);

    const rows = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('article'));
      return cards
        .map((card) => {
          const titleEl = card.querySelector('[data-automation="jobTitle"]');
          const companyEl = card.querySelector('[data-automation="jobCompany"]');
          const salaryEl = card.querySelector('[data-automation="jobSalary"]');
          const locEl = card.querySelector('[data-automation="jobLocation"]');
          const linkEl = titleEl?.closest('a') || card.querySelector('a[href*="/job/"]');

          const title = titleEl?.textContent?.trim() || '';
          const company = companyEl?.textContent?.trim() || 'Undisclosed Company';
          const salary_text = salaryEl?.textContent?.trim() || 'Undisclosed / Negotiable';
          const location = locEl?.textContent?.trim() || 'Jakarta Raya';
          const href = linkEl?.getAttribute('href') || '';
          const vacancy_url = href ? new URL(href, 'https://id.jobstreet.com').toString() : '';

          return { title, company, salary_text, location, vacancy_url };
        })
        .filter((item) => item.title && item.vacancy_url);
    });

    console.log(`[Page ${p}/${END_PAGE}] Extracted ${rows.length} listings.`);
    for (const r of rows) {
      if (!seenUrls.has(r.vacancy_url)) {
        seenUrls.add(r.vacancy_url);
        collected.push({
          ...r,
          work_arrangement: 'On-site',
          source: 'JobStreet Browser Capture',
        });
      }
    }

    await page.waitForTimeout(800);
  }

  await browser.close();
  fs.writeFileSync(OUT_FILE, JSON.stringify(collected, null, 2), 'utf8');
  console.log(`\nSaved ${collected.length} unique vacancies to ${OUT_FILE}`);
  console.log('Upload this JSON file via Import Vacancy -> Multiple URLs (File).');
}

main().catch((err) => {
  console.error('Capture failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
