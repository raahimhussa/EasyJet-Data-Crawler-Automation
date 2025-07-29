import { Actor } from 'apify';
import { PuppeteerCrawler, log, utils, createPuppeteerRouter } from 'crawlee';
import moment from 'moment';
import fs from 'fs';
import qs from 'querystring';

const ACTOR_MEMORY_MBYTES = 8096;

// URL tracking variables
let totalUrlsProcessed = 0;
let startTime = null;
let lastProgressTime = null;

// Progress tracking function
const updateProgress = () => {
    const currentTime = Date.now();
    const elapsedMinutes = (currentTime - startTime) / (1000 * 60);
    const urlsPerMinute = totalUrlsProcessed / elapsedMinutes;
    const targetUrlsPerMinute = 2000 / 60; // 2000 URLs in 60 minutes
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

// Tools functions
const buildAPIQuery = (
    mode,
    departure,
    arrival,
    departureDate,
    returnDate,
    adults,
    children,
    infants,
    language,
) => {
    const query = {
        AdditionalSeats: 0,
        AdultSeats: adults || 1,
        ChildSeats: children || 0,
        DepartureIata: departure,
        IncludeFlexiFares: false,
        IncludeLowestFareSeats: true,
        IncludePrices: true,
        Infants: infants || 0,
        IsTransfer: false,
        LanguageCode: language,
        MaxDepartureDate: moment(departureDate, 'YYYY-MM-DD').add(1, 'days').format('YYYY-MM-DD'),
        MinDepartureDate: moment(departureDate, 'YYYY-MM-DD').subtract(1, 'days').format('YYYY-MM-DD'),
        ArrivalIata: arrival,
        ...(mode === 'ROUND' ? {
            MaxReturnDate: moment(returnDate, 'YYYY-MM-DD').add(1, 'days').format('YYYY-MM-DD'),
            MinReturnDate: moment(returnDate, 'YYYY-MM-DD').subtract(1, 'days').format('YYYY-MM-DD'),
        } : {}),
    };

    const queryString = Object.entries(query).reduce((arr, val) => [...arr, `${val[0]}=${val[1]}`], '').join('&');
    return `https://www.easyjet.com/ejavailability/api/v941/availability/query?${queryString}`;
};

const parseDeepLink = (url) => {
    const parsed = new URL(url);
    const query = qs.parse(parsed.search.replace('?', ''));

    return {
        mode: query.rd ? 'ROUND' : 'ONE',
        departure: query.dep,
        arrival: query.dest,
        departureDate: query.dd,
        returnDate: query.rd,
        adults: query.apax,
        children: query.capax,
        infants: query.ipax,
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
    const { file } = input;

    if (!file || file?.length === 0) {
        throw new Error('Input file is required');
    }
};

const createProxyConfiguration = async ({
    proxyConfig,
    required = true,
    force = Actor.isAtHome(),
    blacklist = ['GOOGLESERP'],
    hint = [],
}) => {
    const configuration = await Actor.createProxyConfiguration(proxyConfig);

    // this works for custom proxyUrls
    if (Actor.isAtHome() && required) {
        if (!configuration || (!configuration.usesApifyProxy && (!configuration.proxyUrls || !configuration.proxyUrls.length)) || !configuration.newUrl()) {
            throw new Error('\n=======\nYou must use Apify proxy or custom proxy URLs\n\n=======');
        }
    }

    // check when running on the platform by default
    if (force) {
        // only when actually using Apify proxy it needs to be checked for the groups
        if (configuration && configuration.usesApifyProxy) {
            if (blacklist.some((blacklisted) => (configuration.groups || []).includes(blacklisted))) {
                throw new Error(`\n=======\nThese proxy groups cannot be used in this actor. Choose other group or contact support@apify.com to give you proxy trial:\n\n*  ${blacklist.join('\n*  ')}\n\n=======`);
            }

            // specific non-automatic proxy groups like RESIDENTIAL, not an error, just a hint
            if (hint.length && !hint.some((group) => (configuration.groups || []).includes(group))) {
                log.info(`\n=======\nYou can pick specific proxy groups for better experience:\n\n*  ${hint.join('\n*  ')}\n\n=======`);
            }
        }
    }

    return configuration;
};

// Router setup
const router = createPuppeteerRouter();

// Fetches home
router.addHandler('HOME', async ({ page, request }) => {
    const {
        startUrl,
        mode,
        departure,
        arrival,
        departureDate,
        returnDate,
        adults,
        children,
        infants,
        language,
    } = request.userData;

    const apiUrl = buildAPIQuery(
        mode,
        departure,
        arrival,
        departureDate,
        returnDate,
        adults,
        children,
        infants,
        language,
    );

    const data = await page.evaluate(({ url }) => {
        return fetch(url, {
            headers: {
                accept: 'application/json, text/plain, */*',
                'accept-language': 'en-US,en;q=0.9',
                adrum: 'isAjax:true',
                'cache-control': 'no-cache',
                pragma: 'no-cache',
                'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Windows"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin',
                'x-b2b-misc': '',
                'x-requested-with': 'XMLHttpRequest',
            },
            referrer: 'https://www.easyjet.com/en/buy/flights?isOneWay=off&pid=www.easyjet.com',
            referrerPolicy: 'strict-origin-when-cross-origin',
            body: null,
            method: 'GET',
            mode: 'cors',
            credentials: 'include',
        }).then((res) => res.text());
    }, {
        url: apiUrl,
    });

    if (data.includes('Access Denied')) {
        throw new Error('We got blocked. Retrying');
    }

    const json = JSON.parse(data);
    const Dataset = await Actor.openDataset(`${departure}-${arrival}-${mode === 'ROUND' ? 'RT' : 'OW'}-${departureDate}`);
    log.info(`CRAWLER: -- Found ${json.AvailableFlights.length} flights on ${startUrl}`);
    await Dataset.pushData(json);

    // Update URL counter and show progress
    totalUrlsProcessed++;
    const currentTime = Date.now();
    
    // Show progress every 50 URLs or every 5 minutes
    if (totalUrlsProcessed % 50 === 0 || !lastProgressTime || (currentTime - lastProgressTime) > 5 * 60 * 1000) {
        updateProgress();
        lastProgressTime = currentTime;
    }

    log.debug(`CRAWLER: -- Fetched flights on ${startUrl} (Total: ${totalUrlsProcessed})`);
});

// Main execution
const main = async () => {
    // Initialize the Apify SDK
    await Actor.init();

    log.info('PHASE -- STARTING ACTOR.');

    const input = await Actor.getInput() || {};

    if (process.argv.length > 2) {
        const args = process.argv;

        input.file = args[2];
        input.proxy = {
            useApifyProxy: false,
            proxyUrls: [
                'http://9721cb34661a4d2278cd__cr.us,gb,de:ffca0a236c645afc@gw.dataimpulse.com:823'   //Easyjet plan
            ],
        };
    }

    // Validate input
    validateInput(input);

    // Initialize tracking variables
    startTime = Date.now();
    lastProgressTime = startTime;
    console.log(`\n=== CRAWLER STARTED ===`);
    console.log(`Start time: ${moment(startTime).format('YYYY-MM-DD HH:mm:ss')}`);
    console.log(`Target: 2000 URLs in 1 hour`);
    console.log(`========================\n`);

    // Proxy configuration
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
            useChrome: true,
            launchOptions: {
                headless: false,
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
            async ({ request, page }) => {
                // Block unnecessary file requests
                await utils.puppeteer.blockRequests(page, {
                    extraUrlPatterns: [
                        '.css',
                        '.jpg',
                        '.jpeg',
                        '.png',
                        '.svg',
                        '.gif',
                        '.woff',
                        '.pdf',
                        '.zip',
                        '*doubleclick*',
                        '*advertising.com*',
                        '*bing.com*',
                        '*bttrack.com*',
                        '*facebook*',
                        '*linkedin*',
                        '*driftt*',
                        '*adsrvr*',
                        '*adobedtm*',
                        '*google-analytics*',
                        '*redditstatic*',
                        '*googletagmanager*',
                        '*sentry*',
                        '*ensighten*',
                        '*appdynamic*',
                        '*googleoptimize*',
                    ],
                });

                return page.goto(request.url, {
                    waitFor: 'domcontentloaded',
                    timeout: 15000,
                });
            },
        ],
        requestHandler: async (context) => {
            const { request } = context;
            log.debug(`CRAWLER -- Processing ${request.url}`);

            // Add to context
            context.input = input;

            // Redirect to route
            await router(context);
        },
    });

    log.info('CRAWLER STARTED.');
    const pages = await getSources(input);
    await crawler.run(pages);

    // Final summary
    const endTime = Date.now();
    const totalTimeMinutes = (endTime - startTime) / (1000 * 60);
    const averageRate = totalUrlsProcessed / totalTimeMinutes;
    
    console.log(`\n=== FINAL SUMMARY ===`);
    console.log(`Total URLs processed: ${totalUrlsProcessed}`);
    console.log(`Total time: ${totalTimeMinutes.toFixed(2)} minutes`);
    console.log(`Average rate: ${averageRate.toFixed(2)} URLs/minute`);
    console.log(`Target achieved: ${totalUrlsProcessed >= 2000 ? 'YES' : 'NO'}`);
    if (totalUrlsProcessed >= 2000) {
        console.log(`Time to reach 2000: ${((2000 / averageRate) * 60).toFixed(2)} minutes`);
    }
    console.log(`=====================\n`);

    await Actor.exit();

    log.info('ACTOR FINISHED.');
};

// Run the main function
main().catch(console.error);