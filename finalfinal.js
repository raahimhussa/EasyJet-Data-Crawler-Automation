/**
 * final.js - UPDATED VERSION
 * Apify / Crawlee crawler for EasyJet with proper session cookie handling
 *
 * KEY CHANGES:
 * 1. Lets page fully load to capture Akamai cookies (_abck, bm_sv, bm_sz)
 * 2. Makes API call from page context (preserves all cookies)
 * 3. Uses proper browser headers (sec-ch-ua, sec-fetch-*, etc.)
 * 4. Generates transaction IDs like real browser
 *
 * Usage: node final.js <input_file>
 */

import { Actor } from 'apify';
import { PuppeteerCrawler, log, utils, createPuppeteerRouter } from 'crawlee';
import moment from 'moment';
import fs from 'fs';
import qs from 'querystring';

let totalUrlsProcessed = 0;
let startTime = null;
let lastProgressTime = null;

const updateProgress = () => {
    const currentTime = Date.now();
    const elapsedMinutes = (currentTime - startTime) / (1000 * 60);
    const urlsPerMinute = elapsedMinutes > 0 ? totalUrlsProcessed / elapsedMinutes : 0;
    const targetUrlsPerMinute = 2000 / 60;
    const estimatedTimeToTarget = urlsPerMinute > 0 ? (2000 - totalUrlsProcessed) / urlsPerMinute : Infinity;

    console.log(`\n=== PROGRESS TRACKING ===`);
    console.log(`Total URLs processed: ${totalUrlsProcessed}`);
    console.log(`Elapsed time: ${elapsedMinutes.toFixed(2)} minutes`);
    console.log(`Current rate: ${urlsPerMinute.toFixed(2)} URLs/minute`);
    console.log(`Target rate: ${targetUrlsPerMinute.toFixed(2)} URLs/minute`);
    console.log(`Progress: ${((totalUrlsProcessed / 2000) * 100).toFixed(2)}%`);
    if (isFinite(estimatedTimeToTarget)) {
        console.log(`Estimated time to reach 2000 URLs: ${estimatedTimeToTarget.toFixed(2)} minutes`);
        console.log(`Estimated completion: ${moment().add(estimatedTimeToTarget, 'minutes').format('YYYY-MM-DD HH:mm:ss')}`);
    } else {
        console.log('Estimated time to reach 2000 URLs: N/A (not enough data)');
    }
    console.log(`========================\n`);
};

const parseDeepLink = (url) => {
    try {
        const parsed = new URL(url);
        const query = qs.parse(parsed.search.replace('?', ''));
        return {
            mode: query.rd ? 'ROUND' : 'ONE',
            departure: query.dep,
            arrival: query.dest,
            departureDate: query.dd,
            returnDate: query.rd,
            adults: query.apax || 1,
            children: query.cpax || query.capax || 0,
            infants: query.ipax || 0,
            language: query.lang || 'EN',
        };
    } catch (err) {
        log.error('Failed to parse deep link', { url, err: err.message });
        return null;
    }
};

const getSources = async (input) => {
    log.debug('Getting sources');
    const fileContent = fs.readFileSync(input.file, 'utf8');
    const startUrls = fileContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    return startUrls.map(startUrl => {
        const meta = parseDeepLink(startUrl) || {};
        return {
            url: startUrl,
            uniqueKey: startUrl,
            userData: {
                label: 'HOME',
                ...meta,
                startUrl,
            },
        };
    });
};

const validateInput = (input) => {
    const { file } = input;
    if (!file || file.length === 0) {
        throw new Error('Input file is required (pass path as first arg)');
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

    if (Actor.isAtHome() && required) {
        if (!configuration || (!configuration.usesApifyProxy && (!configuration.proxyUrls || !configuration.proxyUrls.length)) || !configuration.newUrl()) {
            throw new Error('\n=======\nYou must use Apify proxy or custom proxy URLs\n\n=======');
        }
    }

    if (force) {
        if (configuration && configuration.usesApifyProxy) {
            if (blacklist.some((blacklisted) => (configuration.groups || []).includes(blacklisted))) {
                throw new Error(`\n=======\nThese proxy groups cannot be used in this actor. Choose other group or contact support@apify.com:\n\n*  ${blacklist.join('\n*  ')}\n\n=======`);
            }
            if (hint.length && !hint.some((group) => (configuration.groups || []).includes(group))) {
                log.info(`\n=======\nYou can pick specific proxy groups for better experience:\n\n*  ${hint.join('\n*  ')}\n\n=======`);
            }
        }
    }

    return configuration;
};

// ---------- Router ----------
const router = createPuppeteerRouter();

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

    if (!departure || !arrival || !departureDate) {
        log.warning('Skipping invalid deeplink (missing required params)', { startUrl, requestData: request.userData });
        return;
    }

    log.info('Processing deep link', { startUrl });

    try {
        // Navigate to the page and let it fully load
        // Navigate to the page and let it fully load
await page.goto(startUrl, { 
    waitUntil: 'networkidle2',
    timeout: 90000 
});

// --- CLICK COOKIE CONSENT AND MODAL ---
try {
    // Click "Continue" on modal first
    const continueButton = await page.$('button[data-cy="welcome-modal__button--confirm"]');
    if (continueButton) {
        await continueButton.click();
        log.info('Clicked Continue button');
        await new Promise(resolve => setTimeout(resolve, 5000));
    }

    // Then click "Accept Cookies" if visible
    const acceptCookiesButton = await page.$('#ensCloseBanner');
    if (acceptCookiesButton) {
        await acceptCookiesButton.click();
        log.info('Clicked Accept Cookies button');
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
} catch (clickErr) {
    log.warning('Modal/cookie click failed (may not exist)', { error: clickErr.message });
}


// Wait for the page to fully initialize and set cookies
log.info('Waiting for page to initialize and set Akamai cookies...');
        await new Promise(resolve => setTimeout(resolve, 8000));

        // Try to wait for flight results to appear (but don't fail if they don't)
        await page.waitForSelector('[data-testid="flight-card"], .flight-list, [class*="flight"]', { 
            timeout: 15000 
        }).catch(() => {
            log.info('Flight cards not found yet, continuing...');
        });

        // Additional wait for API calls to complete
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Now get ALL cookies from the page
        const cookies = await page.cookies();
        log.info(`Captured ${cookies.length} cookies from page`);

        // Log important cookies for debugging
        const importantCookies = cookies.filter(c => 
            c.name.includes('_abck') || 
            c.name.includes('bm_') || 
            c.name.includes('ak_bmsc')
        );
        if (importantCookies.length > 0) {
            log.info('✅ Akamai cookies captured:', { 
                cookies: importantCookies.map(c => c.name) 
            });
        } else {
            log.warning('⚠️ No Akamai cookies found - may be blocked');
        }

    } catch (err) {
        log.warning('Navigation/initialization error', { err: err.message });
    }

    // Make API call WITH captured cookies and headers
    log.info('Making API call with captured session...');
    
    try {
        const isRoundTrip = mode === 'ROUND';
        
        // Generate transaction ID (matches browser format)
        const generateTransactionId = () => {
            const hex = () => Math.floor(Math.random() * 65536).toString(16).padStart(4, '0').toUpperCase();
            return `${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}`;
        };

        // Generate labiQueryMeta (matches browser format)
        const generateLabiQueryMeta = () => {
            const isOneWay = !isRoundTrip;
            const currency = 'GBP';
            const uuid = () => {
                return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                    const r = Math.random() * 16 | 0;
                    const v = c == 'x' ? r : (r & 0x3 | 0x8);
                    return v.toString(16);
                });
            };
            return `${departure}${arrival}${departureDate}${returnDate || departureDate}${isOneWay}${isRoundTrip}${language || 'EN'}${currency}${uuid()}`;
        };

        const labiQueryMeta = generateLabiQueryMeta();
        const transactionId = generateTransactionId();

        log.info('API call params:', { labiQueryMeta, transactionId });

        const apiResult = await page.evaluate(async (payloadData) => {
            const payload = {
                journey: {
                    outboundWindow: 1,
                    outboundDate: payloadData.departureDate,
                    departureAirportOrMarketCode: payloadData.departure,
                    arrivalAirportOrMarketCode: payloadData.arrival,
                    outReturnWindow: 1
                },
                passengerMix: {
                    ADT: payloadData.adults,
                    CHD: payloadData.children,
                    INF: payloadData.infants
                },
                labiQueryMeta: payloadData.labiQueryMeta
            };

            try {
                // Make the request exactly like a browser would, with proper headers
                const response = await fetch('https://www.easyjet.com/funnel/api/query', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'Origin': 'https://www.easyjet.com',
                        'Referer': window.location.href,
                        'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
                        'sec-ch-ua-mobile': '?0',
                        'sec-ch-ua-platform': '"macOS"',
                        'sec-fetch-dest': 'empty',
                        'sec-fetch-mode': 'cors',
                        'sec-fetch-site': 'same-origin',
                        'x-language-code': payloadData.language || 'en',
                        'x-transaction-id': payloadData.transactionId
                    },
                    body: JSON.stringify(payload),
                    credentials: 'include' // CRITICAL: This sends all cookies
                });
                
                const status = response.status;
                const responseText = await response.text();
                
                return {
                    status: status,
                    body: responseText,
                    ok: response.ok
                };
            } catch (err) {
                return {
                    status: 0,
                    body: JSON.stringify({ error: err.message }),
                    ok: false
                };
            }
        }, {
            departure, 
            arrival, 
            departureDate,
            adults: Number(adults || 1), 
            children: Number(children || 0), 
            infants: Number(infants || 0),
            labiQueryMeta: labiQueryMeta,
            transactionId: transactionId,
            language: language || 'en'
        });

        // Process the result
        if (apiResult && apiResult.ok && apiResult.status === 200) {
            try {
                const jsonData = JSON.parse(apiResult.body);
                
                if (jsonData.errors) {
                    log.warning('API returned errors', { 
                        errors: jsonData.errors,
                        url: startUrl 
                    });
                } else {
                    // SUCCESS!
                    await saveSuccessfulResult(startUrl, departure, arrival, departureDate, mode, jsonData, 'session-capture');
                    return;
                }
            } catch (parseError) {
                log.warning('Failed to parse API response', { 
                    error: parseError.message,
                    response: apiResult.body.substring(0, 500) 
                });
            }
        } else {
            log.warning('API call failed', { 
                status: apiResult.status,
                response: apiResult.body.substring(0, 500)
            });
        }
    } catch (apiError) {
        log.warning('API call execution failed', { error: apiError.message });
    }

    log.error(`❌ All methods failed for: ${startUrl}`);
    throw new Error('Could not extract flight data');
});

// Save successful results
async function saveSuccessfulResult(startUrl, departure, arrival, departureDate, mode, jsonData, method) {
    const datasetName = `${departure}-${arrival}-${mode === 'ROUND' ? 'RT' : 'OW'}-${departureDate}`;
    const Dataset = await Actor.openDataset(datasetName);
    
    await Dataset.pushData({
        _meta: {
            startUrl,
            capturedBy: method,
            fetchedAt: new Date().toISOString()
        },
        payload: jsonData
    });

    totalUrlsProcessed++;
    
    const currentTime = Date.now();
    if (totalUrlsProcessed % 5 === 0 || !lastProgressTime || (currentTime - lastProgressTime) > 2 * 60 * 1000) {
        updateProgress();
        lastProgressTime = currentTime;
    }

    log.info(`✅ SUCCESS (${method}): Processed ${startUrl} - Total: ${totalUrlsProcessed}`);
}

// ---------- Main ----------
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
        requestHandlerTimeoutSecs: 240, // Increased timeout
        useSessionPool: true,
        maxRequestRetries: 3, // Reduced retries (if it fails, it's likely blocked)
        proxyConfiguration,
        minConcurrency: 1, // Reduced from 6
        maxConcurrency: 3,  // Reduced from 10
        maxRequestsPerMinute: 40, // Add rate limiting
        launchContext: {
            useChrome: true,
            launchOptions: {
                headless: false,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-blink-features=AutomationControlled', // Hide automation
                ],
            },
        },
        browserPoolOptions: {
            fingerprintOptions: {
                fingerprintGeneratorOptions: {
                    devices: ['desktop'],
                    operatingSystems: ['windows', 'macos'],
                    browsers: ['chrome', 'edge'],
                },
            },
        },
        preNavigationHooks: [
            async ({ request, page }) => {
                // MINIMAL blocking - only the most resource-heavy items
                await utils.puppeteer.blockRequests(page, {
                    extraUrlPatterns: [
                        '.css', '.woff', '.woff2', '.gif', '.pdf', '.zip'
                    ],
                });
                
                // Set realistic user agent
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
                
                // Set realistic viewport
                await page.setViewport({ width: 1920, height: 1080 });

                // Hide webdriver property
                await page.evaluateOnNewDocument(() => {
                    Object.defineProperty(navigator, 'webdriver', {
                        get: () => undefined,
                    });
                });
            },
        ],
        requestHandler: async (context) => {
            const { request } = context;
            context.input = input;
            
            // Random delay between requests (looks more human)
            const delay = Math.floor(Math.random() * 2000) + 1000; // 1-3 seconds
            await new Promise(resolve => setTimeout(resolve, delay));
            
            await router(context);
        },
        failedRequestHandler: async ({ request }) => {
            log.warning('Request failed and will not be retried further:', { 
                id: request.id, 
                url: request.url, 
                retryCount: request.retryCount 
            });
        },
    });

    const pages = await getSources(input);
    await crawler.run(pages);

    const endTime = Date.now();
    const totalTimeMinutes = (endTime - startTime) / (1000 * 60);
    const averageRate = totalUrlsProcessed / (totalTimeMinutes || 1);

    console.log(`\n=== FINAL SUMMARY ===`);
    console.log(`Total URLs processed: ${totalUrlsProcessed}`);
    console.log(`Total time: ${totalTimeMinutes.toFixed(2)} minutes`);
    console.log(`Average rate: ${averageRate.toFixed(2)} URLs/minute`);
    console.log(`Target achieved: ${totalUrlsProcessed >= 2000 ? 'YES' : 'NO'}`);
    console.log(`=====================\n`);

    await Actor.exit();
    log.info('ACTOR FINISHED.');
};

main().catch((err) => {
    console.error('Fatal error in main:', err);
    process.exit(1);
});