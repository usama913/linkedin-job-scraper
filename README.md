# LinkedIn Job Scraper

Scrape LinkedIn Jobs by keyword, location and filters — and get structured results in seconds. **No login, no cookies, no browser automation.**

For every job you get the title, company, location, posted date, applicant count, salary info (when LinkedIn shows it), seniority level, employment type, job function, industries, the **full job description**, and the apply link.

## What is it for?

- **Lead generation** — find companies that are hiring (a hiring signal is a buying signal) and feed them into your outreach
- **Recruitment & market research** — track who is hiring for what roles, where, and at which seniority
- **Competitor monitoring** — watch rivals' hiring to spot new products, teams and markets early
- **Job boards & aggregators** — keep your listings fresh with structured, deduplicated job data

## Input

| Field | Description |
|---|---|
| **Keywords** | Job title, skill or company, e.g. `software engineer` |
| **Location** | City, region or country, e.g. `United States`, `London, United Kingdom`, `Remote` |
| **LinkedIn Jobs search URLs** | Optional. Paste full `linkedin.com/jobs/search/...` URLs to scrape exactly those searches (keyword fields are then ignored) |
| **Date posted** | Any time, past 24 hours, past week or past month |
| **Job type** | Full-time, Part-time, Contract, Temporary, Internship, Volunteer, Other |
| **Experience level** | Internship → Executive |
| **Work type** | On-site, Remote, Hybrid |
| **Sort by** | Most relevant or most recent |
| **Maximum jobs** | Cap the run so testing stays fast and cheap |
| **Scrape full job details** | On: full description, criteria, applicants, apply link. Off: fast card-only run (title/company/location/posted date) |
| **Proxy** | Residential proxies recommended — LinkedIn rate-limits datacenter IPs quickly |

Example input:

```json
{
  "keywords": "software engineer",
  "location": "United States",
  "datePosted": "pastWeek",
  "workType": ["remote"],
  "maxItems": 50,
  "scrapeJobDetails": true
}
```

## Output

One dataset item per job:

```json
{
  "id": "4419969671",
  "title": "Senior Software Engineer – Go (Golang)",
  "companyName": "General Motors",
  "companyUrl": "https://www.linkedin.com/company/general-motors",
  "companyLogo": "https://media.licdn.com/...",
  "location": "United States",
  "jobUrl": "https://www.linkedin.com/jobs/view/4419969671",
  "applyUrl": "https://www.linkedin.com/jobs/view/4419969671",
  "postedAtText": "1 day ago",
  "postedAt": "2026-10-23",
  "applicantsText": "37 applicants",
  "salaryText": null,
  "seniorityLevel": "Mid-Senior level",
  "employmentType": "Full-time",
  "jobFunction": "Engineering and Information Technology",
  "industries": "Motor Vehicle Manufacturing",
  "descriptionText": "Full job description as plain text…",
  "descriptionHtml": "<p>Full job description as HTML…</p>",
  "searchUrl": "…",
  "scrapedAt": "2026-10-24T00:00:00.000Z"
}
```

Export to JSON, CSV or Excel, or pull results through the Apify API and integrations (Zapier, Make, Google Sheets, webhooks).

## Pricing

Pay per result — you are charged only for jobs actually saved to the dataset. Actor start is charged per GB of memory, like other Arishma Solutions Actors. Failed or duplicate jobs are never charged.

## Tips

- Start with **Maximum jobs = 25** and details on to check the output shape, then scale up.
- Narrow with **Date posted = Past 24 hours** + a schedule (Apify Schedules) for a daily fresh-jobs feed.
- Turn **details off** for cheap, wide scans; turn them on when you need descriptions for filtering or enrichment.
- Jobs are deduplicated automatically, even across multiple search URLs in one run.

## Notes & limits

- This Actor reads LinkedIn's public (logged-out) job pages. Jobs that LinkedIn only shows to logged-in users will not appear.
- LinkedIn rate-limits aggressively; very large runs need residential proxies and still run at a steady pace by design.
- Only scrape data you are allowed to use, and respect LinkedIn's terms and applicable law.
