import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSearchUrl, parseSearchPage, parseDetailPage, toDatasetItem } from '../src/linkedin.js';

test('buildSearchUrl maps filters to LinkedIn guest params', () => {
    const url = buildSearchUrl({
        keywords: 'software engineer',
        location: 'United States',
        datePosted: 'pastWeek',
        jobType: ['fullTime', 'contract'],
        experienceLevel: ['midSenior'],
        workType: ['remote'],
        sortBy: 'recent',
    }, 50);
    const u = new URL(url);
    assert.equal(u.searchParams.get('keywords'), 'software engineer');
    assert.equal(u.searchParams.get('f_TPR'), 'r604800');
    assert.equal(u.searchParams.get('f_JT'), 'F,C');
    assert.equal(u.searchParams.get('f_E'), '4');
    assert.equal(u.searchParams.get('f_WT'), '2');
    assert.equal(u.searchParams.get('sortBy'), 'DD');
    assert.equal(u.searchParams.get('start'), '50');
});

test('buildSearchUrl converts a pasted search URL and overrides pagination', () => {
    const url = buildSearchUrl(
        { searchUrl: 'https://www.linkedin.com/jobs/search/?keywords=designer&geoId=101165590&start=75' },
        0,
    );
    const u = new URL(url);
    assert.equal(u.searchParams.get('keywords'), 'designer');
    assert.equal(u.searchParams.get('geoId'), '101165590');
    assert.equal(u.searchParams.get('start'), '0');
});

// Fixture: real guest search HTML captured live from linkedin.com on 2026-10-24.
test('parseSearchPage extracts job cards from real guest HTML', () => {
    const html = readFileSync(new URL('./fixtures/search-page.html', import.meta.url), 'utf8');
    const jobs = parseSearchPage(html);
    assert.ok(jobs.length >= 5, `expected >=5 jobs, got ${jobs.length}`);
    const first = jobs[0];
    assert.match(first.id, /^\d{6,}$/);
    assert.ok(first.title && first.title.length > 3, 'title present');
    assert.ok(first.companyName, 'company present');
    assert.ok(first.location, 'location present');
    assert.equal(first.jobUrl, `https://www.linkedin.com/jobs/view/${first.id}`);
    const ids = jobs.map((j) => j.id);
    assert.equal(new Set(ids).size, ids.length, 'ids unique');
});

test('parseDetailPage enriches criteria, description and applicants', () => {
    const html = `
      <div class="top-card-layout">
        <h1 class="top-card-layout__title">Senior Software Engineer</h1>
        <a class="topcard__org-name-link" href="https://www.linkedin.com/company/acme">Acme Inc</a>
        <span class="posted-time-ago__text">2 days ago</span>
        <figcaption class="num-applicants__caption">37 applicants</figcaption>
      </div>
      <div class="show-more-less-html__markup"><p>Build <b>great</b> things.</p></div>
      <ul class="description__job-criteria-list">
        <li><h3 class="description__job-criteria-subheader">Seniority level</h3>
            <span class="description__job-criteria-text">Mid-Senior level</span></li>
        <li><h3 class="description__job-criteria-subheader">Employment type</h3>
            <span class="description__job-criteria-text">Full-time</span></li>
        <li><h3 class="description__job-criteria-subheader">Job function</h3>
            <span class="description__job-criteria-text">Engineering</span></li>
        <li><h3 class="description__job-criteria-subheader">Industries</h3>
            <span class="description__job-criteria-text">Software Development</span></li>
      </ul>`;
    const job = parseDetailPage(html, { id: '1234567890', jobUrl: 'https://www.linkedin.com/jobs/view/1234567890' });
    assert.equal(job.seniorityLevel, 'Mid-Senior level');
    assert.equal(job.employmentType, 'Full-time');
    assert.equal(job.jobFunction, 'Engineering');
    assert.equal(job.industries, 'Software Development');
    assert.equal(job.applicantsText, '37 applicants');
    assert.match(job.descriptionText, /Build great things/);
    const item = toDatasetItem(job, 'https://example.com/search');
    assert.equal(item.id, '1234567890');
    assert.equal(item.applyUrl, item.jobUrl);
    assert.ok(item.scrapedAt);
});

// Fixture: real guest detail HTML captured live from linkedin.com on 2026-10-24
// (General Motors job 4419969671, fetched after a 45s pause — the first attempt 429'd).
test('parseDetailPage extracts real detail fields and rejects the signup CTA as apply URL', () => {
    const html = readFileSync(new URL('./fixtures/detail-page.html', import.meta.url), 'utf8');
    const job = parseDetailPage(html, { id: '4419969671', jobUrl: 'https://www.linkedin.com/jobs/view/4419969671' });
    assert.equal(job.title, 'Senior Software Engineer – Go (Golang)');
    assert.equal(job.companyName, 'General Motors');
    assert.equal(job.applicantsText, '197 applicants');
    assert.equal(job.employmentType, 'Full-time');
    assert.match(job.industries, /Motor Vehicle Manufacturing/);
    assert.ok(job.descriptionText.length > 1000, 'full description extracted');
    // This job has no offsite apply link in guest HTML — only signup CTAs.
    assert.equal(job.applyUrl, job.jobUrl);
});

test('parseDetailPage never throws on empty/garbage HTML', () => {
    const job = parseDetailPage('<html></html>', { id: '1', jobUrl: 'https://www.linkedin.com/jobs/view/1' });
    assert.equal(job.id, '1');
    assert.equal(job.descriptionText, null);
});
