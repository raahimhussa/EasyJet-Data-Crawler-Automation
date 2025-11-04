import { Actor } from 'apify';
import { PuppeteerCrawler, log, utils, createPuppeteerRouter } from 'crawlee';
import moment from 'moment';
import fs from 'fs';
import qs from 'querystring';
import puppeteer from 'puppeteer-extra';

import StealthPlugin from 'puppeteer-extra-plugin-stealth';


puppeteer.use(StealthPlugin());

const ACTOR_MEMORY_MBYTES = 8096;

let totalUrlsProcessed = 0;
let startTime = null;
let lastProgressTime = null;

const updateProgress = () => {
    const currentTime = Date.now();
    const elapsedMinutes = (currentTime - startTime) / (1000 * 60);
    const urlsPerMinute = totalUrlsProcessed / elapsedMinutes;
    const targetUrlsPerMinute = 2000 / 60;
    const estimatedTimeToTarget = (2000 - totalUrlsProcessed) / urlsPerMinute;

    console.log(`\n=== PROGRESS TRACKING ===`);
    console.log(`Total URLs processed: ${totalUrlsProcessed}`);
    console.log(`Elapsed time: ${elapsedMinutes.toFixed(2)} minutes`);
    console.log(`Current rate: ${urlsPerMinute.toFixed(2)} URLs/minute`);
    console.log(`Target rate: ${targetUrlsPerMinute.toFixed(2)} URLs/minute`);
    console.log(`Progress: ${((totalUrlsProcessed / 2000) * 100).toFixed(2)}%`);
    if (urlsPerMinute > 0) {
        console.log(`Estimated time to reach 2000 URLs: ${estimatedTimeToTarget.toFixed(2)} minutes`);
        console.log(`Estimated completion: ${moment().add(estimatedTimeToTarget, 'minutes').format('HH:mm:ss')}`);
    }
    console.log(`========================\n`);
};

// --- NEW QUERY BUILDER FOR FUNNEL API ---
const buildFunnelQuery = (departure, arrival, departureDate, adults = 1, children = 0, infants = 0) => {
    return {
        query: {
            market: "en-gb",
            currency: "GBP",
            passengers: {
                ADULT: adults,
                CHILD: children,
                INFANT: infants
            },
            journeys: [
                {
                    origin: departure,
                    destination: arrival,
                    departureDate
                }
            ],
            options: {
                includePrices: true,
                includeFlexi: false
            }
        }
    };
};

// --- Parse deeplink URLs ---
const parseDeepLink = (url) => {
    const parsed = new URL(url);
    const query = qs.parse(parsed.search.replace('?', ''));

    return {
        mode: query.rd ? 'ROUND' : 'ONE',
        departure: query.dep,
        arrival: query.dest,
        departureDate: query.dd,
        returnDate: query.rd,
        adults: query.apax || 1,
        children: query.capax || 0,
        infants: query.ipax || 0,
        language: query.lang || 'EN',
    };
};

const getSources = async (input) => {
    log.debug('Getting sources');
    const startUrls = fs.readFileSync(input.file, 'utf8').split('\n').filter((line) => line.trim().length > 0);
    return startUrls.map((startUrl) => ({
        url: `https://www.easyjet.com/en/policy/accessibility`,
        uniqueKey: startUrl,
        userData: {
            label: 'HOME',
            ...parseDeepLink(startUrl),
            startUrl,
        },
    }));
};

const validateInput = (input) => {
    if (!input.file || input.file.length === 0) throw new Error('Input file is required');
};

const createProxyConfiguration = async ({
    proxyConfig,
    required = true,
    force = Actor.isAtHome(),
    blacklist = ['GOOGLESERP'],
    hint = [],
}) => {
    const configuration = await Actor.createProxyConfiguration(proxyConfig);
    if (Actor.isAtHome() && required) {
        if (!configuration || (!configuration.usesApifyProxy && (!configuration.proxyUrls || !configuration.proxyUrls.length)) || !configuration.newUrl()) {
            throw new Error('\n=======\nYou must use Apify proxy or custom proxy URLs\n\n=======');
        }
    }
    return configuration;
};

// ROUTER SETUP
const router = createPuppeteerRouter();

router.addHandler('HOME', async ({ page, request }) => {
    const { startUrl, departure, arrival, departureDate, adults, children, infants } = request.userData;

    const apiUrl = `https://www.easyjet.com/funnel/api/query`;
    const payload = buildFunnelQuery(departure, arrival, departureDate, adults, children, infants);

    const data = await page.evaluate(async ({ url, payload }) => {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "accept": "application/json, text/plain, */*",
                "accept-language": "en-GB,en;q=0.9",
                "user-agent": navigator.userAgent,
                "x-requested-with": "XMLHttpRequest"
            },
            body: JSON.stringify(payload),
            credentials: "include"
        });
        return res.text();
    }, { url: apiUrl, payload });

    if (data.includes('Access Denied')) throw new Error('We got blocked. Retrying');

    const json = JSON.parse(data);
    const dataset = await Actor.openDataset(`${departure}-${arrival}-${departureDate}`);
    log.info(`CRAWLER: -- Found ${json?.data?.journeys?.length || 0} journeys on ${startUrl}`);
    await dataset.pushData(json);

    totalUrlsProcessed++;
    const currentTime = Date.now();
    if (totalUrlsProcessed % 50 === 0 || !lastProgressTime || (currentTime - lastProgressTime) > 5 * 60 * 1000) {
        updateProgress();
        lastProgressTime = currentTime;
    }

    log.debug(`CRAWLER: -- Fetched ${startUrl} (Total: ${totalUrlsProcessed})`);
});

// MAIN EXECUTION
const main = async () => {
    await Actor.init();
    log.info('PHASE -- STARTING ACTOR.');

    const input = await Actor.getInput() || {};
    if (process.argv.length > 2) {
        const args = process.argv;
        input.file = args[2];
        input.proxy = {
            useApifyProxy: false,
            proxyUrls: [
                'http://mpuT1QFVbv_easyjet-country-GB:easyjet223@network.joinmassive.com:65534/'
            ],
        };
    }

    validateInput(input);

    startTime = Date.now();
    lastProgressTime = startTime;
    console.log(`\n=== CRAWLER STARTED ===`);
    console.log(`Start time: ${moment(startTime).format('YYYY-MM-DD HH:mm:ss')}`);
    console.log(`Target: 2000 URLs in 1 hour`);
    console.log(`========================\n`);

    const proxyConfiguration = await createProxyConfiguration({
        proxyConfig: input.proxy,
        required: true,
    });

    const REQUEST_QUEUE_NAME = moment().format('YYYYMMDDHHmmssSSS');
    log.info('PHASE -- SETTING UP CRAWLER.');

    const crawler = new PuppeteerCrawler({
        requestQueue: await Actor.openRequestQueue(REQUEST_QUEUE_NAME),
        requestHandlerTimeoutSecs: 120,
        useSessionPool: true,
        maxRequestRetries: 200,
        proxyConfiguration,
        minConcurrency: 15,
        maxConcurrency: 15,
        launchContext: {
    launcher: puppeteer,
    useChrome: true,
    launchOptions: {
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    },
},

        browserPoolOptions: {
            fingerprintOptions: {
                fingerprintGeneratorOptions: {
                    devices: ['desktop'],
                    operatingSystems: ['windows', 'macos'],
                    browsers: ['chrome', 'edge', 'firefox', 'safari'],
                },
            },
        },
        preNavigationHooks: [
            async ({ page, request }) => {
                await utils.puppeteer.blockRequests(page, {
                    extraUrlPatterns: [
                        '.css', '.jpg', '.jpeg', '.png', '.svg', '.gif', '.woff', '.pdf', '.zip',
                        '*doubleclick*', '*advertising.com*', '*bing.com*', '*facebook*',
                        '*linkedin*', '*google-analytics*', '*googletagmanager*'
                    ],
                });

                try {
    await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(resolve => setTimeout(resolve, 60000));
    const bodyText = await page.content();
    if (bodyText.includes('Access Denied') || bodyText.includes('Request unsuccessful')) {
        throw new Error('Access Denied');
    }
} catch (err) {
    log.warning(`Blocked or timed out on ${request.url}: ${err.message}`);
    throw err;
}

            },
        ],
        requestHandler: async (context) => {
            log.debug(`CRAWLER -- Processing ${context.request.url}`);
            await router(context);
        },
    });

    log.info('CRAWLER STARTED.');
    const pages = await getSources(input);
    await crawler.run(pages);

    const endTime = Date.now();
    const totalTimeMinutes = (endTime - startTime) / (1000 * 60);
    const averageRate = totalUrlsProcessed / totalTimeMinutes;

    console.log(`\n=== FINAL SUMMARY ===`);
    console.log(`Total URLs processed: ${totalUrlsProcessed}`);
    console.log(`Total time: ${totalTimeMinutes.toFixed(2)} minutes`);
    console.log(`Average rate: ${averageRate.toFixed(2)} URLs/minute`);
    console.log(`Target achieved: ${totalUrlsProcessed >= 2000 ? 'YES' : 'NO'}`);
    console.log(`=====================\n`);

    await Actor.exit();
    log.info('ACTOR FINISHED.');
};

main().catch(console.error);
