import { Actor } from 'apify';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { PuppeteerCrawler, log, utils, createPuppeteerRouter } from 'crawlee';
import moment from 'moment';
import fs from 'fs';
import qs from 'querystring';

// Add stealth plugin to puppeteer
puppeteer.use(StealthPlugin());

// URL tracking variables
let totalUrlsProcessed = 0;
let startTime = null;
let lastProgressTime = null;

// Progress tracking function
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

// Random delay function
const randomDelay = (min = 1000, max = 3000) => {
    return new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));
};

// Parse the deeplink URL
const parseDeepLink = (url) => {
    const parsed = new URL(url);
    const query = qs.parse(parsed.search.replace('?', ''));

    return {
        mode: query.rd ? 'ROUND' : 'ONE',
        departure: query.dep,
        arrival: query.dest,
        departureDate: query.dd,
        returnDate: query.rd,
        adults: query.apax || '1',
        children: query.capax || '0',
        infants: query.ipax || '0',
        language: query.lang || 'EN',
    };
};

const getSources = async (input) => {
    log.debug('Getting sources');

    const startUrls = fs.readFileSync(input.file, 'utf8').split('\n').filter((line) => line.trim().length > 0);
    
    console.log(`\n📋 Loaded ${startUrls.length} URLs from ${input.file}`);

    return startUrls.map((startUrl) => {
        const parsedData = parseDeepLink(startUrl);
        console.log(`   - ${parsedData.departure} → ${parsedData.arrival} (${parsedData.departureDate})`);
        return {
            url: startUrl,
            uniqueKey: startUrl,
            userData: {
                label: 'SEARCH_FLIGHTS',
                ...parsedData,
                startUrl,
            },
        };
    });
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

    if (Actor.isAtHome() && required) {
        if (!configuration || (!configuration.usesApifyProxy && (!configuration.proxyUrls || !configuration.proxyUrls.length)) || !configuration.newUrl()) {
            throw new Error('\n=======\nYou must use Apify proxy or custom proxy URLs\n\n=======');
        }
    }

    if (force) {
        if (configuration && configuration.usesApifyProxy) {
            if (blacklist.some((blacklisted) => (configuration.groups || []).includes(blacklisted))) {
                throw new Error(`\n=======\nThese proxy groups cannot be used in this actor. Choose other group or contact support@apify.com to give you proxy trial:\n\n*  ${blacklist.join('\n*  ')}\n\n=======`);
            }

            if (hint.length && !hint.some((group) => (configuration.groups || []).includes(group))) {
                log.info(`\n=======\nYou can pick specific proxy groups for better experience:\n\n*  ${hint.join('\n*  ')}\n\n=======`);
            }
        }
    }

    return configuration;
};

// Router setup
const router = createPuppeteerRouter();

// Intercept and capture API responses
router.addHandler('SEARCH_FLIGHTS', async ({ page, request, crawler }) => {
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

    try {
        console.log(`\n🔍 Processing: ${departure} → ${arrival} on ${departureDate}`);
        
        // Add random delay before making request
        await randomDelay(2000, 4000);

        // Set realistic viewport
        await page.setViewport({
            width: 1920 + Math.floor(Math.random() * 100),
            height: 1080 + Math.floor(Math.random() * 100),
            deviceScaleFactor: 1,
            hasTouch: false,
            isLandscape: true,
            isMobile: false,
        });

        // Set up request interception to capture API responses
        await page.setRequestInterception(true);
        
        let apiResponse = null;
        let capturedUrls = [];
        
        const apiPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                console.log(`\n⚠️  TIMEOUT: Did not receive API response in 60 seconds`);
                console.log(`📡 Captured URLs during this request:`);
                capturedUrls.forEach(url => console.log(`   - ${url}`));
                reject(new Error('API response timeout after 80 seconds'));
            }, 80000);

            page.on('response', async (response) => {
                try {
                    const url = response.url();
                    const status = response.status();
                    
                    // Log all responses for debugging
                    if (url.includes('easyjet.com') && !url.includes('.jpg') && !url.includes('.png') && !url.includes('.css')) {
                        capturedUrls.push(`${status} - ${url.substring(0, 100)}...`);
                    }
                    
                    // Check if this is the availability API response
                    if (url.includes('availability') || url.includes('flight') || url.includes('search')) {
                        console.log(`   📡 Found potential API: ${url.substring(0, 100)}... [${status}]`);
                        
                        const contentType = response.headers()['content-type'] || '';
                        if (contentType.includes('application/json')) {
                            const text = await response.text();
                            
                            if (text && text.length > 0) {
                                try {
                                    const json = JSON.parse(text);
                                    console.log(`   📦 JSON Response keys: ${Object.keys(json).join(', ')}`);
                                    
                                    // Look for flight data in various possible structures
                                    if (json.AvailableFlights || 
                                        json.availableFlights || 
                                        json.flights || 
                                        json.Flights ||
                                        json.data?.flights ||
                                        json.data?.AvailableFlights) {
                                        
                                        console.log(`   ✅ Found flight data!`);
                                        clearTimeout(timeout);
                                        resolve(json);
                                    }
                                } catch (e) {
                                    console.log(`   ❌ Could not parse JSON: ${e.message}`);
                                }
                            }
                        }
                    }
                } catch (error) {
                    // Silent catch for common errors
                }
            });
        });

        // Handle requests
        page.on('request', (request) => {
            const url = request.url();
            
            // Block unnecessary resources but allow API calls
            if (
                url.includes('.jpg') ||
                url.includes('.jpeg') ||
                url.includes('.png') ||
                url.includes('.gif') ||
                url.includes('.woff') ||
                url.includes('.woff2') ||
                url.includes('.ttf') ||
                url.includes('doubleclick') ||
                url.includes('google-analytics') ||
                url.includes('googletagmanager') ||
                url.includes('facebook') ||
                url.includes('linkedin') ||
                url.includes('twitter')
            ) {
                request.abort();
            } else {
                request.continue();
            }
        });

        // Navigate to the deep link URL
        console.log(`   🌐 Navigating to deeplink...`);
        const response = await page.goto(startUrl, {
            waitUntil: 'networkidle2',
            timeout: 120000,
        });

        console.log(`   📄 Page loaded with status: ${response.status()}`);
        
        // Check if we're on the right page
        const pageUrl = page.url();
        console.log(`   🔗 Current URL: ${pageUrl}`);
        
        // Wait for page to load and make API calls
        console.log(`   ⏳ Waiting for API calls...`);
        await randomDelay(5000, 8000);

        // Try to wait for the API response
        try {
            apiResponse = await apiPromise;
        } catch (error) {
            // Try alternative approach: look for data in the page
            console.log(`   🔄 Trying to extract data from page...`);
            
            const pageData = await page.evaluate(() => {
                // Try to find data in window object
                if (window.__INITIAL_STATE__) return window.__INITIAL_STATE__;
                if (window.__NEXT_DATA__) return window.__NEXT_DATA__;
                if (window.flightData) return window.flightData;
                if (window.availabilityData) return window.availabilityData;
                
                // Try to find it in script tags
                const scripts = document.querySelectorAll('script');
                for (let script of scripts) {
                    const content = script.textContent;
                    if (content.includes('AvailableFlights') || content.includes('availableFlights')) {
                        try {
                            // Try to extract JSON
                            const match = content.match(/(\{[\s\S]*\})/);
                            if (match) {
                                return JSON.parse(match[1]);
                            }
                        } catch (e) {}
                    }
                }
                
                return null;
            });

            if (pageData && (pageData.AvailableFlights || pageData.availableFlights)) {
                console.log(`   ✅ Found data in page!`);
                apiResponse = pageData;
            } else {
                throw error;
            }
        }

        if (!apiResponse) {
            throw new Error('No API response captured and no data found in page');
        }

        // Normalize response structure
        const flightData = apiResponse.AvailableFlights || 
                          apiResponse.availableFlights || 
                          apiResponse.flights ||
                          apiResponse.Flights ||
                          apiResponse.data?.flights ||
                          apiResponse.data?.AvailableFlights ||
                          [];

        const Dataset = await Actor.openDataset(`${departure}-${arrival}-${mode === 'ROUND' ? 'RT' : 'OW'}-${departureDate}`);
        
        console.log(`   ✅ Found ${flightData.length} flights`);
        
        await Dataset.pushData({
            ...apiResponse,
            _metadata: {
                departure,
                arrival,
                departureDate,
                returnDate,
                mode,
                scrapedAt: new Date().toISOString(),
                url: startUrl,
            }
        });

        // Update URL counter and show progress
        totalUrlsProcessed++;
        const currentTime = Date.now();
        
        if (totalUrlsProcessed % 10 === 0 || !lastProgressTime || (currentTime - lastProgressTime) > 5 * 60 * 1000) {
            updateProgress();
            lastProgressTime = currentTime;
        }

        console.log(`   ✅ SUCCESS (Total: ${totalUrlsProcessed})\n`);
        
    } catch (error) {
        console.log(`   ❌ ERROR: ${error.message}\n`);
        throw error;
    }
});

// Main execution
const main = async () => {
    await Actor.init();

    console.log('\n🚀 EASYJET FLIGHT SCRAPER STARTING...\n');

    const input = await Actor.getInput() || {};

    if (process.argv.length > 2) {
        const args = process.argv;
        input.file = args[2];
        input.proxy = {
            useApifyProxy: false,
            proxyUrls: [
                'http://9721cb34661a4d2278cd__cr.us,gb,de:ffca0a236c645afc@gw.dataimpulse.com:823'
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
        requestHandlerTimeoutSecs: 180,
        useSessionPool: true,
        sessionPoolOptions: {
            maxPoolSize: 50,
            sessionOptions: {
                maxUsageCount: 30,
            },
        },
        maxRequestRetries: 3,
        proxyConfiguration,
        minConcurrency: 2,
        maxConcurrency: 4,
        launchContext: {
            launcher: puppeteer,
            useChrome: true,
            launchOptions: {
                headless: 'false',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--disable-blink-features=AutomationControlled',
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--lang=en-US,en',
                    '--window-size=1920,1080',
                ],
            },
        },
        browserPoolOptions: {
            useFingerprints: true,
            fingerprintOptions: {
                fingerprintGeneratorOptions: {
                    devices: ['desktop'],
                    operatingSystems: ['windows'],
                    browsers: [{ name: 'chrome', minVersion: 120, maxVersion: 126 }],
                },
            },
        },
        preNavigationHooks: [
            async ({ request, page, session }) => {
                // Set user agent
                const userAgents = [
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                ];
                await page.setUserAgent(userAgents[Math.floor(Math.random() * userAgents.length)]);

                // Set extra headers
                await page.setExtraHTTPHeaders({
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1',
                });
            },
        ],
        requestHandler: async (context) => {
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
    console.log(`Target achieved: ${totalUrlsProcessed >= 2000 ? 'YES ✅' : 'NO ❌'}`);
    if (totalUrlsProcessed >= 2000) {
        console.log(`Time to reach 2000: ${((2000 / averageRate)).toFixed(2)} minutes`);
    }
    console.log(`=====================\n`);

    await Actor.exit();

    log.info('ACTOR FINISHED.');
};

main().catch(console.error);