/**
 * easyjet-crawler-fixed.js
 * Working version that bypasses 403 errors by intercepting network responses
 * instead of making manual API calls
 */

import { Actor } from 'apify';
import { PuppeteerCrawler, log, utils, createPuppeteerRouter } from 'crawlee';
import moment from 'moment';
import fs from 'fs';
import qs from 'querystring';

let totalUrlsProcessed = 0;
let totalSuccessful = 0;
let totalFailed = 0;
let startTime = null;

// ========== PROXY CONFIGURATION ==========
const generateMassiveProxies = (count = 40) => {
    const proxies = [];
    for (let i = 1; i <= count; i++) {
        proxies.push(
            `http://mpuT1QFVbv_easyjet-country-GB-session-${i}:easyjet223@network.joinmassive.com:65534/`
        );
    }
    console.log(`Generated ${proxies.length} proxy URLs`);
    return proxies;
};

// ========== PARSING ==========
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
    if (!input.file || input.file.length === 0) {
        throw new Error('Input file is required');
    }
};

// ========== ROUTER ==========
const router = createPuppeteerRouter();

router.addHandler('HOME', async ({ page, request, proxyInfo }) => {
    const { startUrl, departure, arrival, departureDate, mode } = request.userData;

    if (!departure || !arrival || !departureDate) {
        log.warning('Skipping invalid deeplink', { startUrl });
        totalFailed++;
        return;
    }

    log.info('Processing deep link', { startUrl });

    let apiDataCaptured = null;
    let apiResponseReceived = false;

    // ========== CRITICAL: INTERCEPT RESPONSES INSTEAD OF MAKING API CALLS ==========
    // This is the key difference - we let the browser make the real request
    // and intercept the response, which includes all proper Akamai tokens
    
    const responseListener = async (response) => {
        const url = response.url();
        
        // Look for the actual flight data API endpoint
        if (url.includes('/funnel/api/query') && 
            !url.includes('auth-status') && 
            !url.includes('airports')) {
            
            try {
                const status = response.status();
                log.info('✅ Intercepted API call', { url, status });
                
                if (status === 200) {
                    const contentType = response.headers()['content-type'];
                    
                    if (contentType && contentType.includes('application/json')) {
                        const data = await response.json();
                        
                        // Check if this is actually flight data
                        if (data && (data.data || data.results || data.journeys)) {
                            apiDataCaptured = data;
                            apiResponseReceived = true;
                            log.info('✅ Captured flight data successfully');
                        }
                    }
                } else if (status === 403) {
                    log.warning('❌ Got 403 on API call', { url });
                }
            } catch (err) {
                log.debug('Could not parse response', { err: err.message });
            }
        }
    };

    // Attach the listener BEFORE navigation
    page.on('response', responseListener);

    try {
        // Navigate and wait for the page to load
        await page.goto(startUrl, { 
            waitUntil: 'domcontentloaded',
            timeout: 45000  // Further reduced
        });

        // Skip waiting for flight cards - go straight to DOM extraction
        log.info('Page loaded, attempting immediate extraction...');
        
        // Minimal wait
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Check if we captured data from interception
        if (apiResponseReceived && apiDataCaptured) {
            await saveSuccessfulResult(
                startUrl, 
                departure, 
                arrival, 
                departureDate, 
                mode, 
                apiDataCaptured, 
                'response-interception'
            );
            totalSuccessful++;
            return;
        }

        // Skip button clicking - go straight to DOM extraction
        log.info('Extracting data from DOM...');
        
        const pageData = await page.evaluate(() => {
            // Try to find React props or window data
            const scripts = Array.from(document.querySelectorAll('script'));
            for (const script of scripts) {
                const text = script.textContent;
                if (text && (text.includes('__NEXT_DATA__') || text.includes('flights') || text.includes('journey'))) {
                    try {
                        // Try to extract JSON data
                        const matches = text.match(/({[\s\S]*})/);
                        if (matches) {
                            return JSON.parse(matches[1]);
                        }
                    } catch (e) {
                        // Continue searching
                    }
                }
            }
            
            // Check window object
            if (window.__NEXT_DATA__) return window.__NEXT_DATA__;
            if (window.__INITIAL_STATE__) return window.__INITIAL_STATE__;
            
            return null;
        });

        if (pageData) {
            await saveSuccessfulResult(
                startUrl, 
                departure, 
                arrival, 
                departureDate, 
                mode, 
                pageData, 
                'dom-extraction'
            );
            totalSuccessful++;
            return;
        }

        // If we got here, extraction failed
        log.error('❌ Failed to capture data for:', startUrl);
        totalFailed++;
        throw new Error('Could not capture flight data');

    } catch (err) {
        log.error('Error processing page', { err: err.message, startUrl });
        totalFailed++;
        throw err;
    } finally {
        // Clean up listener (use .off() for Puppeteer, not .removeListener)
        try {
            page.off('response', responseListener);
        } catch (e) {
            // Ignore cleanup errors
        }
    }
});

// ========== SAVE RESULTS ==========
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
    
    if (totalUrlsProcessed % 10 === 0) {
        const elapsed = (Date.now() - startTime) / (1000 * 60);
        const rate = totalUrlsProcessed / elapsed;
        log.info(`📊 Progress: ${totalUrlsProcessed} processed (${totalSuccessful} success, ${totalFailed} failed) - ${rate.toFixed(1)} URLs/min`);
    }

    log.info(`✅ SUCCESS (${method}): ${startUrl}`);
}

// ========== MAIN ==========
const main = async () => {
    await Actor.init();
    
    const input = await Actor.getInput() || {};

    if (process.argv.length > 2) {
        input.file = process.argv[2];
        input.proxy = {
            useApifyProxy: false,
            proxyUrls: generateMassiveProxies(40),
        };
    }

    validateInput(input);
    startTime = Date.now();

    const proxyConfiguration = await Actor.createProxyConfiguration(input.proxy);

    const crawler = new PuppeteerCrawler({
        requestQueue: await Actor.openRequestQueue(),
        requestHandlerTimeoutSecs: 90, // Aggressive timeout
        useSessionPool: true,
        sessionPoolOptions: {
            maxPoolSize: 40,
            sessionOptions: {
                maxUsageCount: 15,
            },
        },
        maxRequestRetries: 3,
        proxyConfiguration,
        
        minConcurrency: 1,
        maxConcurrency: 5, // Reduced to fit in 4GB RAM (15 browsers × 270MB ≈ 4GB)
        maxRequestsPerMinute: 200, // Keep high request rate
        
        launchContext: {
            useChrome: true,
            launchOptions: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-blink-features=AutomationControlled',
                ],
            },
        },
        browserPoolOptions: {
            maxOpenPagesPerBrowser: 1,
            retireBrowserAfterPageCount: 20,
        },
        preNavigationHooks: [
            async ({ page }) => {
                // Block unnecessary resources
                await utils.puppeteer.blockRequests(page, {
                    extraUrlPatterns: ['.css', '.woff', '.woff2', '.gif', '.pdf', '.zip', '.jpg', '.png']
                });
                
                // Randomize fingerprint
                const userAgents = [
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                ];
                await page.setUserAgent(userAgents[Math.floor(Math.random() * userAgents.length)]);
                
                await page.setViewport({ 
                    width: 1920, 
                    height: 1080 
                });

                // Hide automation
                await page.evaluateOnNewDocument(() => {
                    Object.defineProperty(navigator, 'webdriver', {
                        get: () => undefined,
                    });
                    window.chrome = { runtime: {} };
                });
            },
        ],
        requestHandler: async (context) => {
            // Minimal delay for maximum speed
            await new Promise(resolve => setTimeout(resolve, 200)); // 200ms only
            await router(context);
        },
        failedRequestHandler: async ({ request }) => {
            log.warning('Request failed:', { url: request.url, retryCount: request.retryCount });
        },
    });

    const pages = await getSources(input);
    console.log(`\n🚀 Starting crawler with ${pages.length} URLs\n`);
    
    await crawler.run(pages);

    const totalTime = (Date.now() - startTime) / (1000 * 60);
    const rate = totalUrlsProcessed / totalTime;

    console.log(`\n=== FINAL SUMMARY ===`);
    console.log(`Total processed: ${totalUrlsProcessed}`);
    console.log(`Successful: ${totalSuccessful}`);
    console.log(`Failed: ${totalFailed}`);
    console.log(`Success rate: ${((totalSuccessful / totalUrlsProcessed) * 100).toFixed(1)}%`);
    console.log(`Total time: ${totalTime.toFixed(2)} minutes`);
    console.log(`Average rate: ${rate.toFixed(2)} URLs/minute`);
    console.log(`=====================\n`);

    await Actor.exit();
};

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});