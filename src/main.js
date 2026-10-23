// LinkedIn Job Scraper — no login, no cookies.
// Uses LinkedIn's public guest jobs API (the same pages a logged-out visitor sees),
// paginates search results, and optionally opens each job for full details.
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import {
    buildSearchUrl,
    buildDetailUrl,
    parseSearchPage,
    parseDetailPage,
    toDatasetItem,
} from './linkedin.js';

await Actor.init();

const input = (await Actor.getInput()) || {};
const {
    keywords = '',
    location = '',
    startUrls = [],
    scrapeJobDetails = true,
    proxyConfiguration,
} = input;
const maxItems = Math.max(1, Number(input.maxItems) || 25);

// One search source per startUrl, or a single keyword search.
const sourceUrls = (Array.isArray(startUrls) && startUrls.length
    ? startUrls.map((s) => (typeof s === 'string' ? s : s?.url)).filter(Boolean)
    : [null]);

if (!sourceUrls[0] && !keywords && !location) {
    throw new Error(
        'Nothing to search: provide "keywords" and/or "location", or pass LinkedIn Jobs search URLs in "startUrls".',
    );
}

const proxy = proxyConfiguration
    ? await Actor.createProxyConfiguration(proxyConfiguration)
    : undefined;
if (!proxyConfiguration?.useApifyProxy) {
    log.warning(
        'No Apify proxy configured. LinkedIn rate-limits datacenter IPs fast (HTTP 429) — expect short runs only. Residential proxies are recommended.',
    );
}

// Persisted across retries/migrations: dedupe set + accepted-job counter.
// "planned" counts every job accepted (pushed, or queued for its detail page),
// so maxItems is respected exactly once per job. trafficBytes/trafficUnits meter
// Apify Proxy usage for the proxy-traffic charge (1 unit = 100 KB).
const state = await Actor.useState('linkedin-jobs-state', {
    seenIds: [], planned: 0, saved: 0, trafficBytes: 0, trafficUnits: 0,
});
const seen = new Set(state.seenIds);

// Pricing (single plan, same for everyone — PAY_PER_EVENT):
//   result        $0.003 per job saved            ($3.00 / 1,000 results)
//   proxy-traffic $0.0008 per 100 KB through Apify Proxy ($0.80 / 1,000 units)
//   apify-actor-start $0.00005 — charged by the platform at run start, not in code.
const proxyEnabled = Boolean(proxyConfiguration?.useApifyProxy);

const chargeResult = async () => {
    // Charge only for jobs actually saved to the dataset.
    try {
        await Actor.charge({ eventName: 'result', count: 1 });
    } catch (err) {
        log.debug(`Charge skipped: ${err.message}`);
    }
};

// Approximate proxy traffic from response bodies and charge each full 100 KB.
// Only metered when the run actually goes through Apify Proxy.
const meterTraffic = async (bytes) => {
    if (!proxyEnabled || !bytes) return;
    state.trafficBytes += bytes;
    const units = Math.floor(state.trafficBytes / 102400);
    const diff = units - state.trafficUnits;
    if (diff > 0) {
        state.trafficUnits = units;
        try {
            await Actor.charge({ eventName: 'proxy-traffic', count: diff });
        } catch (err) {
            log.debug(`Proxy-traffic charge skipped: ${err.message}`);
        }
    }
};

const crawler = new CheerioCrawler({
    proxyConfiguration: proxy,
    maxConcurrency: 5,
    maxRequestRetries: 5,
    requestHandlerTimeoutSecs: 60,
    // LinkedIn answers abuse with 429; Crawlee retries with fresh sessions/proxies.
    async requestHandler({ request, body, crawler: cr }) {
        const { label } = request.userData;
        await meterTraffic(body?.length || 0);

        if (label === 'DETAIL') {
            const { job, searchUrl } = request.userData;
            let item;
            try {
                item = toDatasetItem(parseDetailPage(body.toString(), job), searchUrl);
            } catch (err) {
                log.warning(`Detail parse failed for job ${job.id}, saving card data only: ${err.message}`);
                item = toDatasetItem(job, searchUrl);
            }
            await Dataset.pushData(item);
            state.saved += 1;
            await chargeResult();
            log.info(`Saved ${state.saved}: ${item.title || item.id} @ ${item.companyName || '?'}`);
            return;
        }

        // SEARCH page — guest API HTML fragment of job cards.
        const jobs = parseSearchPage(body.toString());
        const start = request.userData.start || 0;
        log.info(`Search page start=${start}: ${jobs.length} job cards`);
        let freshCount = 0;

        for (const job of jobs) {
            if (state.planned >= maxItems) break;
            if (seen.has(job.id)) continue;
            seen.add(job.id);
            freshCount += 1;
            state.seenIds = [...seen];
            state.planned += 1;

            if (scrapeJobDetails) {
                await cr.addRequests([{
                    url: buildDetailUrl(job.id),
                    uniqueKey: `detail-${job.id}`,
                    userData: { label: 'DETAIL', job, searchUrl: request.userData.searchUrl },
                }]);
            } else {
                await Dataset.pushData(toDatasetItem(job, request.userData.searchUrl));
                state.saved += 1;
                await chargeResult();
                log.info(`Saved ${state.saved}/${maxItems}: ${job.title || job.id} @ ${job.companyName || '?'}`);
            }
        }

        // Paginate while pages keep yielding new jobs and more are still needed.
        // Advance start by the cards actually returned (guest API page size varies).
        if (jobs.length > 0 && freshCount > 0 && state.planned < maxItems) {
            const nextStart = start + jobs.length;
            const searchUrl = sourceUrls[request.userData.sourceIndex];
            await cr.addRequests([{
                url: buildSearchUrl({ ...input, searchUrl }, nextStart),
                uniqueKey: `search-${request.userData.sourceIndex}-${nextStart}`,
                userData: {
                    label: 'SEARCH',
                    start: nextStart,
                    sourceIndex: request.userData.sourceIndex,
                    searchUrl: request.userData.searchUrl,
                },
            }]);
        }
    },
    async failedRequestHandler({ request }, error) {
        log.error(`Request failed after retries: ${request.url} — ${error.message}`);
        // A dead detail page must not lose the job: save the search-card data instead.
        if (request.userData?.label === 'DETAIL') {
            const { job, searchUrl } = request.userData;
            await Dataset.pushData(toDatasetItem(job, searchUrl));
            state.saved += 1;
            await chargeResult();
            log.warning(`Saved card-only fallback for job ${job.id} after detail failure.`);
        }
    },
});

const initialRequests = sourceUrls.map((searchUrl, i) => ({
    url: buildSearchUrl({ ...input, searchUrl }, 0),
    uniqueKey: `search-${i}-0`,
    userData: {
        label: 'SEARCH',
        start: 0,
        sourceIndex: i,
        searchUrl: searchUrl || buildSearchUrl({ ...input }, 0),
    },
}));

log.info(`Starting: ${sourceUrls.length} search source(s), maxItems=${maxItems}, details=${scrapeJobDetails}`);
await crawler.run(initialRequests);
log.info(`Done. Jobs saved: ${state.saved} (planned ${state.planned})`);

await Actor.exit();
