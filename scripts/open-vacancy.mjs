/**
 * Permitted User-Initiated Browser Workflow Helper
 *
 * Launches a local visible browser window to a specific, user-approved vacancy URL
 * so the user can review and manually complete Glints authentication & submission.
 *
 * Compliance rules:
 * - Never scrapes Glints without authorization.
 * - Never bypasses CAPTCHA, login walls, or anti-bot checks.
 * - Never auto-submits applications unattended.
 *
 * Usage on Ubuntu desktop (with playwright installed):
 *   node scripts/open-vacancy.mjs "https://glints.com/id/opportunities/jobs/..."
 */

const targetUrl = process.argv[2];

if (!targetUrl || (!targetUrl.startsWith('https://') && !targetUrl.startsWith('http://'))) {
  console.error('Usage: node scripts/open-vacancy.mjs <https://vacancy-url>');
  process.exit(1);
}

async function main() {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    console.error(
      'Playwright is not installed yet. Install it locally when needed with:\n  npm install -D playwright && npx playwright install chromium'
    );
    process.exit(1);
  }

  const browser = await playwright.chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log(`Opening user-approved URL in visible browser: ${targetUrl}`);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

  console.log('Browser is open for manual user review and authorized submission.');
  console.log('Close the browser window when finished.');

  await new Promise((resolve) => {
    browser.on('disconnected', resolve);
  });
}

main().catch((err) => {
  console.error('Browser helper error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
