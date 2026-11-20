export interface ExtractedJobStreetListing {
  title: string;
  company: string;
  salary_text: string;
  salary_min_idr: number | null;
  salary_max_idr: number | null;
  salary_negotiable: boolean;
  location: string;
  vacancy_url: string;
  page?: number;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseIndonesianSalaryRange(rawSalary: string): {
  salary_text: string;
  salary_min_idr: number | null;
  salary_max_idr: number | null;
  salary_negotiable: boolean;
} {
  const cleaned = stripTags(rawSalary);
  if (!cleaned) {
    return {
      salary_text: 'Undisclosed / Negotiable',
      salary_min_idr: null,
      salary_max_idr: null,
      salary_negotiable: true,
    };
  }

  // Match shorthand IDR juta ranges like "10 - 15 jt", "Rp 8.5 – 12 juta", or "IDR 10jt - 15jt"
  const jutaRangeMatch = cleaned.match(
    /(?:rp|idr)?\s*(\d+(?:[.,]\d+)?)\s*(?:jt|juta|m)?\s*(?:[-–—]|to|s\/d|hingga)\s*(?:rp|idr)?\s*(\d+(?:[.,]\d+)?)\s*(?:jt|juta|m)\b/i
  );
  if (jutaRangeMatch) {
    const a = Math.round(parseFloat(jutaRangeMatch[1].replace(',', '.')) * 1_000_000);
    const b = Math.round(parseFloat(jutaRangeMatch[2].replace(',', '.')) * 1_000_000);
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) {
      return {
        salary_text: cleaned,
        salary_min_idr: Math.min(a, b),
        salary_max_idr: Math.max(a, b),
        salary_negotiable: /nego|negotiable|kompetitif/i.test(cleaned),
      };
    }
  }

  // Match IDR numbers like "10 jt" / "10.5 juta"
  const jutaMatches = Array.from(cleaned.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:jt|juta|m)\b/gi));
  if (jutaMatches.length > 0) {
    const nums = jutaMatches
      .map((m) => Math.round(parseFloat(m[1].replace(',', '.')) * 1_000_000))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (nums.length >= 2) {
      return {
        salary_text: cleaned,
        salary_min_idr: Math.min(nums[0], nums[1]),
        salary_max_idr: Math.max(nums[0], nums[1]),
        salary_negotiable: /nego|negotiable|kompetitif/i.test(cleaned),
      };
    }
    if (nums.length === 1) {
      return {
        salary_text: cleaned,
        salary_min_idr: nums[0],
        salary_max_idr: null,
        salary_negotiable: /nego|negotiable|kompetitif/i.test(cleaned),
      };
    }
  }

  const fullMatches = Array.from(cleaned.matchAll(/(?:rp|idr)?\s*(\d{1,3}(?:[.,]\d{3})+)/gi));
  const fullNums = fullMatches
    .map((m) => Number(m[1].replace(/[.,]/g, '')))
    .filter((n) => Number.isFinite(n) && n >= 500_000);

  if (fullNums.length >= 2) {
    return {
      salary_text: cleaned,
      salary_min_idr: Math.min(fullNums[0], fullNums[1]),
      salary_max_idr: Math.max(fullNums[0], fullNums[1]),
      salary_negotiable: /nego|negotiable|kompetitif/i.test(cleaned),
    };
  }
  if (fullNums.length === 1) {
    return {
      salary_text: cleaned,
      salary_min_idr: fullNums[0],
      salary_max_idr: null,
      salary_negotiable: /nego|negotiable|kompetitif/i.test(cleaned),
    };
  }

  return {
    salary_text: cleaned,
    salary_min_idr: null,
    salary_max_idr: null,
    salary_negotiable: true,
  };
}

export function isCloudflareChallengeHtml(html: string): boolean {
  return (
    /cf-browser-verification|challenges\.cloudflare\.com|__cf_chl_|Just a moment\.\.\./i.test(html) &&
    !html.includes('data-automation="jobTitle"') &&
    !html.includes('SEEK_REDUX_DATA')
  );
}

function normalizeJobStreetUrl(rawHref: string, baseOrigin = 'https://id.jobstreet.com'): string {
  const cleanHref = decodeHtmlEntities(rawHref).trim();
  if (!cleanHref) return '';
  try {
    const resolved = new URL(cleanHref, baseOrigin);
    resolved.hash = '';
    // Keep canonical job path without tracking params
    const tracking = ['type', 'origin', 'ref', 'sol', 'tracking'];
    for (const k of tracking) resolved.searchParams.delete(k);
    return resolved.toString();
  } catch {
    return '';
  }
}

function extractFromSeekReduxJson(html: string, pageNum?: number): ExtractedJobStreetListing[] {
  const results: ExtractedJobStreetListing[] = [];
  const markerMatch = html.match(/window\.SEEK_REDUX_DATA\s*=\s*(\{[\s\S]*?\});\s*<\/script>/i);
  if (!markerMatch?.[1]) return results;

  try {
    const parsed = JSON.parse(markerMatch[1]) as Record<string, unknown>;
    const resultsObj = parsed?.results as Record<string, unknown> | undefined;
    const nestedResults = resultsObj?.results as Record<string, unknown> | undefined;
    const jobsList = (nestedResults?.jobs || resultsObj?.jobs || []) as Array<Record<string, unknown>>;

    if (!Array.isArray(jobsList)) return results;

    for (const item of jobsList) {
      const title = String(item.title || '').trim();
      const advertiser = item.advertiser as Record<string, unknown> | undefined;
      const company = String(
        advertiser?.description || item.companyName || 'Undisclosed Company'
      ).trim();
      const rawSalary = String(item.salary || '').trim();
      const salaryParsed = parseIndonesianSalaryRange(rawSalary);
      const jobId = item.id ? String(item.id) : '';
      const vacancyUrl = jobId
        ? `https://id.jobstreet.com/id/job/${jobId}`
        : normalizeJobStreetUrl(String(item.url || ''));
      const location = String(
        (item.locations as Array<Record<string, unknown>> | undefined)?.[0]?.label ||
          item.location ||
          'Jakarta Raya'
      ).trim();

      if (title && vacancyUrl) {
        results.push({
          title,
          company,
          ...salaryParsed,
          location,
          vacancy_url: vacancyUrl,
          page: pageNum,
        });
      }
    }
  } catch {
    // Ignore malformed embedded JSON and let DOM extractor run
  }

  return results;
}

function extractFromJobCardsHtml(html: string, pageNum?: number): ExtractedJobStreetListing[] {
  const results: ExtractedJobStreetListing[] = [];
  const seenUrls = new Set<string>();

  // Split around <article ...> cards (JobStreet / SEEK standard job card element)
  const articleBlocks = html.match(/<article\b[\s\S]*?<\/article>/gi) || [];

  for (const card of articleBlocks) {
    const titleMatch =
      card.match(/<a[^>]*data-automation=["']jobTitle["'][^>]*>([\s\S]*?)<\/a>/i) ||
      card.match(/data-automation=["']jobTitle["'][^>]*>([\s\S]*?)<\/(?:a|span|h3)>/i);
    const titleTagMatch = card.match(/<a[^>]*data-automation=["']jobTitle["'][^>]*>/i);
    const hrefMatch =
      titleTagMatch?.[0].match(/href=["']([^"']+)["']/i) ||
      card.match(/href=["']([^"']*\/job\/\d+[^"']*)["']/i);

    const companyMatch =
      card.match(/<a[^>]*data-automation=["']jobCompany["'][^>]*>([\s\S]*?)<\/a>/i) ||
      card.match(/data-automation=["']jobCompany["'][^>]*>([\s\S]*?)<\/(?:a|span|div)>/i);

    const salaryMatch =
      card.match(/data-automation=["']jobSalary["'][^>]*>([\s\S]*?)<\/(?:span|div|p)>/i) ||
      card.match(/((?:Rp|IDR)\s*\d[\d.,\s]*(?:[-–—]|to|s\/d)?[\d.,\s]*(?:jt|juta)?)/i);

    const locationMatch = card.match(
      /data-automation=["']jobLocation["'][^>]*>([\s\S]*?)<\/(?:a|span|div)>/i
    );

    const title = titleMatch?.[1] ? stripTags(titleMatch[1]) : '';
    const company = companyMatch?.[1] ? stripTags(companyMatch[1]) : 'Undisclosed Company';
    const rawSalary = salaryMatch?.[1] ? stripTags(salaryMatch[1]) : '';
    const salaryParsed = parseIndonesianSalaryRange(rawSalary);
    const location = locationMatch?.[1] ? stripTags(locationMatch[1]) : 'Jakarta Raya';
    const vacancyUrl = hrefMatch?.[1] ? normalizeJobStreetUrl(hrefMatch[1]) : '';

    if (title && vacancyUrl && !seenUrls.has(vacancyUrl)) {
      seenUrls.add(vacancyUrl);
      results.push({
        title,
        company,
        ...salaryParsed,
        location,
        vacancy_url: vacancyUrl,
        page: pageNum,
      });
    }
  }

  return results;
}

export function extractJobStreetListings(
  html: string,
  pageNum?: number
): ExtractedJobStreetListing[] {
  const fromRedux = extractFromSeekReduxJson(html, pageNum);
  if (fromRedux.length > 0) {
    return fromRedux;
  }
  return extractFromJobCardsHtml(html, pageNum);
}

export function buildJobStreetPageUrl(baseUrl: string, page: number): string {
  const parsed = new URL(baseUrl.trim());
  parsed.searchParams.set('page', String(page));
  return parsed.toString();
}
