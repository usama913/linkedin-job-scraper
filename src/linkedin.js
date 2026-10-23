// Pure LinkedIn Jobs (guest / no-login) logic: URL building + HTML parsing.
// Kept dependency-light (cheerio only) so it can be unit-tested without Apify.
import * as cheerio from 'cheerio';

export const GUEST_SEARCH_API =
    'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
export const GUEST_DETAIL_API =
    'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting';
export const PAGE_SIZE = 10; // Observed live 2026-10-24: the guest API returns 10 cards per page; pagination increments start by the number of cards actually returned

const DATE_POSTED = { past24Hours: 'r86400', pastWeek: 'r604800', pastMonth: 'r2592000' };
const JOB_TYPE = { fullTime: 'F', partTime: 'P', contract: 'C', temporary: 'T', internship: 'I', volunteer: 'V', other: 'O' };
const EXPERIENCE = { internship: '1', entry: '2', associate: '3', midSenior: '4', director: '5', executive: '6' };
const WORK_TYPE = { onSite: '1', remote: '2', hybrid: '3' };

const joinMapped = (values, map) =>
    (values || []).map((v) => map[v]).filter(Boolean).join(',');

/**
 * Build the guest search URL for one results page.
 * Accepts either a user-supplied search URL (linkedin.com/jobs/search?...)
 * converted to the guest API, or keyword/location/filter fields.
 */
export function buildSearchUrl(input, start = 0) {
    const params = new URLSearchParams();

    if (input.searchUrl) {
        const src = new URL(input.searchUrl);
        for (const [k, v] of src.searchParams.entries()) params.set(k, v);
    } else {
        if (input.keywords) params.set('keywords', input.keywords);
        if (input.location) params.set('location', input.location);
        if (input.datePosted && DATE_POSTED[input.datePosted])
            params.set('f_TPR', DATE_POSTED[input.datePosted]);
        const jt = joinMapped(input.jobType, JOB_TYPE);
        if (jt) params.set('f_JT', jt);
        const exp = joinMapped(input.experienceLevel, EXPERIENCE);
        if (exp) params.set('f_E', exp);
        const wt = joinMapped(input.workType, WORK_TYPE);
        if (wt) params.set('f_WT', wt);
        if (input.sortBy === 'recent') params.set('sortBy', 'DD');
    }

    params.set('start', String(start));
    // Guest API needs a position/pageNum pair to paginate consistently.
    params.set('position', '1');
    params.set('pageNum', String(Math.floor(start / PAGE_SIZE)));
    return `${GUEST_SEARCH_API}?${params.toString()}`;
}

export function buildDetailUrl(jobId) {
    return `${GUEST_DETAIL_API}/${jobId}`;
}

export function jobPageUrl(jobId) {
    return `https://www.linkedin.com/jobs/view/${jobId}`;
}

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim() || null;

function cardToJob($, el) {
    const $el = $(el);
    const urn = $el.find('[data-entity-urn]').first().attr('data-entity-urn')
        || $el.attr('data-entity-urn') || '';
    const idMatch = urn.match(/jobPosting:(\d+)/);
    const link = $el.find('a.base-card__full-link, a.base-search-card__full-link').first().attr('href') || '';
    const idFromLink = link.match(/-(\d{6,})(?:\?|$)/);
    const id = idMatch?.[1] || idFromLink?.[1] || null;
    if (!id) return null;

    const $img = $el.find('img.artdeco-entity-image, img').first();
    const postedEl = $el.find('time.job-search-card__listdate, time').first();

    return {
        id,
        title: clean($el.find('.base-search-card__title').first().text()),
        companyName: clean($el.find('.base-search-card__subtitle').first().text()),
        companyUrl: (() => {
            const href = $el.find('.base-search-card__subtitle a').first().attr('href');
            return href ? href.split('?')[0] : null;
        })(),
        companyLogo: $img.attr('data-delayed-url') || $img.attr('src') || null,
        location: clean($el.find('.job-search-card__location').first().text()),
        jobUrl: jobPageUrl(id),
        postedAtText: clean(postedEl.text()),
        postedAt: postedEl.attr('datetime') || null,
        salaryText: clean($el.find('.job-search-card__salary-info').first().text()),
        benefitsText: clean($el.find('.job-search-card__benefits').first().text()),
    };
}

/** Parse one guest search results page into job card objects. */
export function parseSearchPage(html) {
    const $ = cheerio.load(html);
    const jobs = [];
    // Cards live in <li> wrappers on the guest API response.
    $('li').each((_, li) => {
        if ($(li).find('.job-search-card, .base-search-card').length) {
            const job = cardToJob($, li);
            if (job) jobs.push(job);
        }
    });
    if (!jobs.length) {
        $('.job-search-card, .base-search-card').each((_, el) => {
            const job = cardToJob($, el);
            if (job) jobs.push(job);
        });
    }
    // Dedupe within the page, keep order.
    const seen = new Set();
    return jobs.filter((j) => (seen.has(j.id) ? false : (seen.add(j.id), true)));
}

const CRITERIA_LABELS = {
    'seniority level': 'seniorityLevel',
    'employment type': 'employmentType',
    'job function': 'jobFunction',
    industries: 'industries',
};

/** Enrich a job card with fields from its guest detail page. Defensive:
 * every field falls back to null instead of throwing on markup changes. */
export function parseDetailPage(html, job) {
    const $ = cheerio.load(html);
    const out = { ...job };

    out.title = out.title
        || clean($('.top-card-layout__title, .topcard__title, h1').first().text());
    out.companyName = out.companyName
        || clean($('.topcard__org-name-link, .top-card-layout__second-subline a').first().text());

    const descEl = $('.show-more-less-html__markup, .description__text, .jobs-description__content').first();
    out.descriptionHtml = descEl.length ? descEl.html()?.trim() || null : null;
    out.descriptionText = descEl.length ? clean(descEl.text()) : null;

    out.applicantsText = clean(
        $('.num-applicants__caption, .top-card-layout__second-subline .num-applicants__caption').first().text(),
    ) || clean($('figcaption.num-applicants__caption').first().text());

    const posted = clean($('.posted-time-ago__text, .topcard__flavor--metadata.posted-time-ago').first().text());
    if (posted && !out.postedAtText) out.postedAtText = posted;

    // Criteria list: Seniority level / Employment type / Job function / Industries
    $('.description__job-criteria-list > li, .job-criteria__list > li').each((_, li) => {
        const label = clean($(li).find('.description__job-criteria-subheader, .job-criteria__subheader').first().text())?.toLowerCase();
        const value = clean($(li).find('.description__job-criteria-text, .job-criteria__text').first().text());
        const key = label && CRITERIA_LABELS[label];
        if (key && value && !out[key]) out[key] = value;
    });
    out.seniorityLevel = out.seniorityLevel || null;
    out.employmentType = out.employmentType || null;
    out.jobFunction = out.jobFunction || null;
    out.industries = out.industries || null;

    // Offsite apply link when LinkedIn exposes one. Guest pages for on-LinkedIn
    // applications only show signup/login CTAs — those are not apply links, so
    // fall back to the job page itself (the real apply path).
    const applyHref = $('a[data-tracking-control-name*="apply-link-offsite"], a[data-tracking-control-name*="apply_link"], .top-card-layout__cta--primary')
        .first().attr('href');
    out.applyUrl = applyHref
        && /^https?:\/\//.test(applyHref)
        && !applyHref.includes('linkedin.com/signup')
        && !applyHref.includes('linkedin.com/login')
        ? applyHref
        : out.jobUrl;

    const salary = clean($('.compensation__salary, .salary-main-rail__data-body').first().text());
    if (salary && !out.salaryText) out.salaryText = salary;

    return out;
}

/** Final dataset item shape — one place so README, schema and code stay in sync. */
export function toDatasetItem(job, searchUrl) {
    return {
        id: job.id,
        title: job.title || null,
        companyName: job.companyName || null,
        companyUrl: job.companyUrl || null,
        companyLogo: job.companyLogo || null,
        location: job.location || null,
        jobUrl: job.jobUrl,
        applyUrl: job.applyUrl || job.jobUrl,
        postedAtText: job.postedAtText || null,
        postedAt: job.postedAt || null,
        applicantsText: job.applicantsText || null,
        salaryText: job.salaryText || null,
        seniorityLevel: job.seniorityLevel || null,
        employmentType: job.employmentType || null,
        jobFunction: job.jobFunction || null,
        industries: job.industries || null,
        descriptionText: job.descriptionText || null,
        descriptionHtml: job.descriptionHtml || null,
        searchUrl: searchUrl || null,
        scrapedAt: new Date().toISOString(),
    };
}
