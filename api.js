/**
 * api-checker.js - Test both EasyJet API endpoints
 * Usage: node api-checker.js
 * 
 * This will test:
 * 1. Old API endpoint (/ejavailability/api/v941/availability/query)
 * 2. New API endpoint (/funnel/api/query)
 */

import { Actor } from 'apify';
import { PuppeteerCrawler, log } from 'crawlee';
import moment from 'moment';

const TEST_FLIGHT = {
    departure: 'LGW',
    arrival: 'AMS',
    departureDate: moment().add(30, 'days').format('YYYY-MM-DD'),
    returnDate: moment().add(37, 'days').format('YYYY-MM-DD'),
    adults: 1,
    children: 0,
    infants: 0,
    language: 'EN',
    mode: 'ROUND'
};

// Build OLD API URL
const buildOldAPIUrl = () => {
    const query = {
        AdditionalSeats: 0,
        AdultSeats: TEST_FLIGHT.adults,
        ChildSeats: TEST_FLIGHT.children,
        DepartureIata: TEST_FLIGHT.departure,
        IncludeFlexiFares: false,
        IncludeLowestFareSeats: true,
        IncludePrices: true,
        Infants: TEST_FLIGHT.infants,
        IsTransfer: false,
        LanguageCode: TEST_FLIGHT.language,
        MaxDepartureDate: moment(TEST_FLIGHT.departureDate).add(1, 'days').format('YYYY-MM-DD'),
        MinDepartureDate: moment(TEST_FLIGHT.departureDate).subtract(1, 'days').format('YYYY-MM-DD'),
        ArrivalIata: TEST_FLIGHT.arrival,
        MaxReturnDate: moment(TEST_FLIGHT.returnDate).add(1, 'days').format('YYYY-MM-DD'),
        MinReturnDate: moment(TEST_FLIGHT.returnDate).subtract(1, 'days').format('YYYY-MM-DD'),
    };
    return `https://www.easyjet.com/ejavailability/api/v941/availability/query?${new URLSearchParams(query)}`;
};

// Build NEW API payload
const buildNewAPIPayload = () => {
    const generateLabiQueryMeta = () => {
        const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
        return `${TEST_FLIGHT.departure}${TEST_FLIGHT.arrival}${TEST_FLIGHT.departureDate}${TEST_FLIGHT.returnDate}false${TEST_FLIGHT.mode === 'ROUND'}${TEST_FLIGHT.language}GBP${uuid}`;
    };

    const generateTransactionId = () => {
        const hex = () => Math.floor(Math.random() * 65536).toString(16).padStart(4, '0').toUpperCase();
        return `${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}`;
    };

    return {
        payload: {
            journey: {
                outboundWindow: 1,
                outboundDate: TEST_FLIGHT.departureDate,
                departureAirportOrMarketCode: TEST_FLIGHT.departure,
                arrivalAirportOrMarketCode: TEST_FLIGHT.arrival,
                outReturnWindow: 1,
                returnDate: TEST_FLIGHT.returnDate
            },
            passengerMix: {
                ADT: TEST_FLIGHT.adults,
                CHD: TEST_FLIGHT.children,
                INF: TEST_FLIGHT.infants
            },
            labiQueryMeta: generateLabiQueryMeta()
        },
        transactionId: generateTransactionId(),
        language: TEST_FLIGHT.language.toLowerCase()
    };
};

const main = async () => {
    await Actor.init();

    console.log('\n=== EASYJET API ENDPOINT CHECKER ===');
    console.log(`Test Route: ${TEST_FLIGHT.departure} → ${TEST_FLIGHT.arrival}`);
    console.log(`Travel Dates: ${TEST_FLIGHT.departureDate} - ${TEST_FLIGHT.returnDate}`);
    console.log(`Passengers: ${TEST_FLIGHT.adults} adult(s)\n`);

    // Setup proxy (use your actual proxy)
    const proxyConfiguration = await Actor.createProxyConfiguration({
        useApifyProxy: false,
        proxyUrls: [
            'http://mpuT1QFVbv_easyjet-country-GB:easyjet223@network.joinmassive.com:65534/'
        ],
    });

    const crawler = new PuppeteerCrawler({
        proxyConfiguration,
        maxConcurrency: 1,
        launchContext: {
            useChrome: true,
            launchOptions: {
                headless: false, // Set to false to watch what happens
            },
        },
        requestHandler: async ({ page }) => {
            console.log('\n📍 Navigating to EasyJet homepage...');
            await page.goto('https://www.easyjet.com/en', { 
                waitUntil: 'networkidle2',
                timeout: 30000 
            });

            // Wait a bit for cookies to be set
            console.log('⏳ Waiting for initial cookies...');
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Check cookies
            const cookies = await page.cookies();
            console.log(`\n🍪 Captured ${cookies.length} cookies`);
            const akamaiCookies = cookies.filter(c => 
                c.name.includes('_abck') || 
                c.name.includes('bm_') || 
                c.name.includes('ak_bmsc')
            );
            if (akamaiCookies.length > 0) {
                console.log('   ✅ Akamai cookies found:', akamaiCookies.map(c => c.name).join(', '));
            } else {
                console.log('   ⚠️  No Akamai cookies detected');
            }

            // ==========================================
            // TEST 1: OLD API ENDPOINT
            // ==========================================
            console.log('\n\n═══════════════════════════════════════');
            console.log('TEST 1: OLD API ENDPOINT');
            console.log('═══════════════════════════════════════');
            
            const oldApiUrl = buildOldAPIUrl();
            console.log('📡 Endpoint:', oldApiUrl.substring(0, 80) + '...');
            
            const oldApiResult = await page.evaluate(async (url) => {
                const startTime = Date.now();
                try {
                    const response = await fetch(url, {
                        headers: {
                            'accept': 'application/json, text/plain, */*',
                            'accept-language': 'en-US,en;q=0.9',
                            'cache-control': 'no-cache',
                            'pragma': 'no-cache',
                            'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124"',
                            'sec-ch-ua-mobile': '?0',
                            'sec-ch-ua-platform': '"Windows"',
                            'sec-fetch-dest': 'empty',
                            'sec-fetch-mode': 'cors',
                            'sec-fetch-site': 'same-origin',
                            'x-requested-with': 'XMLHttpRequest',
                        },
                        credentials: 'include'
                    });
                    
                    const endTime = Date.now();
                    const text = await response.text();
                    
                    return { 
                        status: response.status, 
                        ok: response.ok,
                        body: text,
                        responseTime: endTime - startTime,
                        headers: Object.fromEntries(response.headers.entries())
                    };
                } catch (err) {
                    return { 
                        status: 0, 
                        ok: false,
                        body: err.message,
                        error: true 
                    };
                }
            }, oldApiUrl);

            console.log('\n📊 OLD API RESULTS:');
            console.log(`   Status: ${oldApiResult.status}`);
            console.log(`   Success: ${oldApiResult.ok ? '✅' : '❌'}`);
            if (oldApiResult.responseTime) {
                console.log(`   Response Time: ${oldApiResult.responseTime}ms`);
            }
            
            if (oldApiResult.ok && oldApiResult.status === 200) {
                try {
                    const jsonData = JSON.parse(oldApiResult.body);
                    if (jsonData.AvailableFlights) {
                        console.log(`   ✅ SUCCESS! Found ${jsonData.AvailableFlights.length} flights`);
                        console.log(`   📦 Response size: ${(oldApiResult.body.length / 1024).toFixed(2)} KB`);
                        console.log('\n   ✨ OLD API IS WORKING! ✨');
                    } else {
                        console.log('   ⚠️  Unexpected response format');
                        console.log('   Response preview:', oldApiResult.body.substring(0, 200));
                    }
                } catch (parseErr) {
                    console.log('   ❌ Failed to parse JSON');
                    console.log('   Response preview:', oldApiResult.body.substring(0, 200));
                }
            } else {
                console.log(`   ❌ OLD API FAILED`);
                console.log('   Response preview:', oldApiResult.body.substring(0, 300));
                
                if (oldApiResult.body.includes('Access Denied')) {
                    console.log('   🚫 BLOCKED: Access Denied response');
                } else if (oldApiResult.body.includes('404')) {
                    console.log('   🚫 ENDPOINT NOT FOUND (404)');
                } else if (oldApiResult.body.includes('403')) {
                    console.log('   🚫 FORBIDDEN (403) - Possible bot detection');
                }
            }

            // ==========================================
            // TEST 2: NEW API ENDPOINT
            // ==========================================
            console.log('\n\n═══════════════════════════════════════');
            console.log('TEST 2: NEW API ENDPOINT');
            console.log('═══════════════════════════════════════');
            
            // First navigate to a search page to get proper context
            const testUrl = `https://www.easyjet.com/en/cheap-flights/${TEST_FLIGHT.departure}/${TEST_FLIGHT.arrival}?dep=${TEST_FLIGHT.departure}&dest=${TEST_FLIGHT.arrival}&dd=${TEST_FLIGHT.departureDate}&rd=${TEST_FLIGHT.returnDate}&apax=1`;
            console.log('📍 Navigating to search page for proper context...');
            console.log('   URL:', testUrl);
            
            await page.goto(testUrl, { 
                waitUntil: 'networkidle2',
                timeout: 60000 
            });
            
            console.log('⏳ Waiting for Akamai cookies to be set...');
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            const newApiPayload = buildNewAPIPayload();
            console.log('📡 Endpoint: https://www.easyjet.com/funnel/api/query');
            console.log('📦 Payload:', JSON.stringify(newApiPayload.payload, null, 2).substring(0, 200) + '...');
            
            const newApiResult = await page.evaluate(async (data) => {
                const startTime = Date.now();
                try {
                    const response = await fetch('https://www.easyjet.com/funnel/api/query', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json',
                            'Origin': 'https://www.easyjet.com',
                            'Referer': window.location.href,
                            'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142"',
                            'sec-ch-ua-mobile': '?0',
                            'sec-ch-ua-platform': '"Windows"',
                            'sec-fetch-dest': 'empty',
                            'sec-fetch-mode': 'cors',
                            'sec-fetch-site': 'same-origin',
                            'x-language-code': data.language,
                            'x-transaction-id': data.transactionId
                        },
                        body: JSON.stringify(data.payload),
                        credentials: 'include'
                    });
                    
                    const endTime = Date.now();
                    const text = await response.text();
                    
                    return { 
                        status: response.status, 
                        ok: response.ok,
                        body: text,
                        responseTime: endTime - startTime,
                        headers: Object.fromEntries(response.headers.entries())
                    };
                } catch (err) {
                    return { 
                        status: 0, 
                        ok: false,
                        body: err.message,
                        error: true 
                    };
                }
            }, newApiPayload);

            console.log('\n📊 NEW API RESULTS:');
            console.log(`   Status: ${newApiResult.status}`);
            console.log(`   Success: ${newApiResult.ok ? '✅' : '❌'}`);
            if (newApiResult.responseTime) {
                console.log(`   Response Time: ${newApiResult.responseTime}ms`);
            }
            
            if (newApiResult.ok && newApiResult.status === 200) {
                try {
                    const jsonData = JSON.parse(newApiResult.body);
                    if (jsonData.errors) {
                        console.log('   ⚠️  API returned errors:', jsonData.errors);
                    } else {
                        console.log(`   ✅ SUCCESS!`);
                        console.log(`   📦 Response size: ${(newApiResult.body.length / 1024).toFixed(2)} KB`);
                        console.log('\n   ✨ NEW API IS WORKING! ✨');
                    }
                } catch (parseErr) {
                    console.log('   ❌ Failed to parse JSON');
                    console.log('   Response preview:', newApiResult.body.substring(0, 200));
                }
            } else {
                console.log(`   ❌ NEW API FAILED`);
                console.log('   Response preview:', newApiResult.body.substring(0, 300));
                
                if (newApiResult.body.includes('Access Denied')) {
                    console.log('   🚫 BLOCKED: Access Denied response');
                } else if (newApiResult.body.includes('404')) {
                    console.log('   🚫 ENDPOINT NOT FOUND (404)');
                } else if (newApiResult.body.includes('403')) {
                    console.log('   🚫 FORBIDDEN (403) - Possible bot detection');
                }
            }

            // ==========================================
            // FINAL RECOMMENDATION
            // ==========================================
            console.log('\n\n═══════════════════════════════════════');
            console.log('RECOMMENDATION');
            console.log('═══════════════════════════════════════');
            
            const oldWorks = oldApiResult.ok && oldApiResult.status === 200;
            const newWorks = newApiResult.ok && newApiResult.status === 200;
            
            if (oldWorks && newWorks) {
                console.log('✅ BOTH APIs work! Use hybrid approach for maximum speed.');
                console.log('   → Prioritize OLD API (faster, no page load needed)');
                console.log('   → Fallback to NEW API if blocked');
            } else if (oldWorks) {
                console.log('✅ OLD API works! Use it for maximum speed.');
                console.log('   → No page load needed');
                console.log('   → Can achieve 50+ URLs/minute');
            } else if (newWorks) {
                console.log('✅ NEW API works! OLD API is blocked/removed.');
                console.log('   → Requires full page load');
                console.log('   → Expect 20-30 URLs/minute');
            } else {
                console.log('❌ BOTH APIs failed!');
                console.log('   Possible reasons:');
                console.log('   - Bot detection / Akamai blocking');
                console.log('   - Proxy issues');
                console.log('   - Need to adjust headers/cookies');
                console.log('   - Rate limiting');
            }
            
            console.log('\n═══════════════════════════════════════\n');
        },
    });

    await crawler.run([{ 
        url: 'https://www.easyjet.com/en',
        uniqueKey: 'test'
    }]);

    await Actor.exit();
};

main().catch(console.error);