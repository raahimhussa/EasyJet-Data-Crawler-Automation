const fs = require("fs").promises;
const { chromium } = require("playwright");
const config = require("./config");

// User agent rotation for stealth
const userAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15"
];

function getRandomUserAgent() {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

function randomDelay(min = config.delays.min, max = config.delays.max) {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.random() * (max - min) + min)
  );
}

async function readURLs(filePath) {
  const data = await fs.readFile(filePath, "utf-8");
  return data
    .split("\n")
    .filter((url) => url.trim().startsWith("https://www.easyjet.com/deeplink"))
    .map((url) => url.trim());
}

function parseURL(url) {
  const params = new URL(url).searchParams;
  return {
    departure: params.get("dep"),
    destination: params.get("dest"),
    date: params.get("dd"),
    isOneWay: params.get("isOneWay") === "off" ? false : true,
  };
}

async function initBrowser() {
  const browserOptions = {
    headless: config.production.headless,
    slowMo: config.browser.slowMo,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=TranslateUI, VizDisplayCompositor',
      '--disable-ipc-flooding-protection',
      '--disable-web-security',
      '--disable-blink-features=AutomationControlled',
      '--disable-extensions',
      '--no-default-browser-check',
      '--disable-sync',
      '--disable-translate',
      '--hide-scrollbars',
      '--mute-audio',
      '--disable-background-networking',
      '--disable-client-side-phishing-detection',
      '--force-color-profile=srgb',
      '--metrics-recording-only',
      '--use-mock-keychain'
    ]
  };

  if (config.production.enableProxy && config.proxy.server) {
    browserOptions.proxy = config.proxy;
  }

  const browser = await chromium.launch(browserOptions);
  const context = await browser.newContext({
    userAgent: getRandomUserAgent(),
    viewport: config.browser.viewport,
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    permissions: ['geolocation'],
    geolocation: { longitude: -0.118092, latitude: 51.509865 },
    extraHTTPHeaders: {
      'Accept-Language': 'en-GB,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0',
      'Origin': 'https://www.easyjet.com',
      'Referer': 'https://www.easyjet.com/'
    }
  });

  // Advanced stealth script for Akamai and other bot detection
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-GB', 'en'] });

    // Spoof canvas fingerprint
    const originalCanvas = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type) {
      const context = originalCanvas.call(this, type);
      if (type === '2d') {
        const originalGetImageData = context.getImageData;
        context.getImageData = function(...args) {
          const data = originalGetImageData.apply(this, args);
          for (let i = 0; i < data.data.length; i += 4) {
            data.data[i] += Math.floor(Math.random() * 3) - 1;
            data.data[i + 1] += Math.floor(Math.random() * 3) - 1;
            data.data[i + 2] += Math.floor(Math.random() * 3) - 1;
          }
          return data;
        };
      }
      return context;
    };

    // Spoof WebGL
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) return 'Intel Inc.';
      if (parameter === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter.apply(this, [parameter]);
    };

    // Override permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);

    // Override chrome object
    window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {}, app: {} };

    // Override toString for stealth
    const originalToString = Function.prototype.toString;
    Function.prototype.toString = function() {
      if (this === Function.prototype.toString) return originalToString.call(originalToString);
      if (this === window.navigator.permissions.query) return 'function query() { [native code] }';
      return originalToString.call(this);
    };
  });

  return { browser, context };
}

async function handleAkamaiChallenge(page) {
    console.log("Checking for Akamai challenges...");
    try {
      await page.waitForTimeout(5000); // Increased initial wait
      const challengeSelectors = [
        'text="Checking your browser"',
        'text="Please wait while we verify"',
        'text="Security check"',
        'text="Access denied"',
        'text="Blocked"',
        '[id*="akamai"]',
        '[class*="akamai"]'
      ];
  
      for (const selector of challengeSelectors) {
        const element = await page.locator(selector).first();
        if (await element.isVisible()) {
          console.log(`Akamai challenge detected: ${selector}`);
          await saveScreenshot(page, 'akamai-challenge');
          console.log("Waiting for Akamai challenge to complete...");
          await page.waitForTimeout(45000); // Increased to 45 seconds
          if (await element.isVisible()) {
            console.log("Akamai challenge still present, retrying navigation...");
            await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
            await page.waitForTimeout(45000);
            if (await element.isVisible()) {
              return false;
            }
          }
          console.log("Akamai challenge completed successfully");
          return true;
        }
      }
      console.log("No Akamai challenge detected");
      return true;
    } catch (e) {
      console.log("Error checking for Akamai challenge:", e.message);
      return true;
    }
  }

async function handleErrorPopup(page) {
  try {
    const errorPopup = await page.locator('text="Error"').first();
    if (await errorPopup.isVisible()) {
      console.log("EasyJet error popup detected, attempting to close...");
      try {
        await page.click('button:has-text("Exit to homepage")', { timeout: 3000 });
        await randomDelay(1000, 2000);
        return true;
      } catch (e) {
        console.log("Could not close error popup");
        return true;
      }
    }
  } catch (e) {}
  return false;
}

async function mimicHumanActions(page) {
    const hadError = await handleErrorPopup(page);
    if (hadError) {
      throw new Error("EasyJet error popup encountered");
    }
  
    await randomDelay(2000, 4000);
  
    // Handle Cookies popup
    try {
      const cookiePopup = await page.locator('div[role="dialog"]:has-text("Cookies")').first();
      if (await cookiePopup.isVisible()) {
        console.log("Cookies popup detected, attempting to accept...");
        // Look for an accept button (adjust selector based on actual HTML)
        const acceptButton = await page.locator('button:has-text("Accept")').first();
        if (await acceptButton.isVisible()) {
          await acceptButton.click({ delay: 150 });
          console.log("Accepted cookies");
        } else {
          console.log("No explicit Accept button found, assuming auto-close or external action");
        }
        await randomDelay(1500, 3000);
      }
    } catch (e) {
      console.log("No Cookies popup found or failed to handle:", e.message);
    }
  
    // Handle Welcome to easyJet popup
    try {
      const welcomePopup = await page.locator('div[role="dialog"]:has-text("Welcome to easyJet")').first();
      if (await welcomePopup.isVisible()) {
        console.log("Welcome popup detected, clicking Continue...");
        const continueButton = await page.locator('button:has-text("Continue")').first();
        if (await continueButton.isVisible()) {
          await continueButton.click({ delay: 150 });
          console.log("Clicked Continue");
          await page.waitForSelector('text="Welcome to easyJet"', { state: 'detached', timeout: 10000 });
        }
        await randomDelay(2000, 4000);
      }
    } catch (e) {
      console.log("No Welcome popup found or failed to handle:", e.message);
    }
  
    // Human-like behavior
    for (let i = 0; i < 5; i++) {
      try {
        const x = Math.random() * 1000 + 200;
        const y = Math.random() * 600 + 200;
        const steps = Math.floor(Math.random() * 20) + 10;
        await page.mouse.move(x, y, { steps });
        await randomDelay(300, 1200);
      } catch (e) {}
    }
  
    try {
      const scrollAmount = Math.random() * 400 + 200;
      await page.mouse.wheel(0, scrollAmount);
      await randomDelay(800, 2000);
      await page.mouse.wheel(0, -(Math.random() * 300 + 100));
      await randomDelay(800, 2000);
    } catch (e) {}
  
    try {
      const clickableElements = await page.locator('a, button, [role="button"], input, select').all();
      if (clickableElements.length > 0) {
        const randomElement = clickableElements[Math.floor(Math.random() * Math.min(clickableElements.length, 8))];
        if (await randomElement.isVisible()) {
          await randomElement.hover();
          await randomDelay(300, 800);
        }
      }
    } catch (e) {}
  }

async function saveScreenshot(page, errorType) {
  if (!config.production.saveScreenshots) return;
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${config.outputDir}/screenshot-${errorType}-${timestamp}.png`;
    await page.screenshot({ path: filename, fullPage: true });
    console.log(`Screenshot saved: ${filename}`);
  } catch (e) {
    console.warn(`Failed to save screenshot: ${e.message}`);
  }
}

async function crawlURL(page, url) {
    try {
      await page.context().clearCookies();
  
      console.log("Navigating to EasyJet homepage first...");
      await page.goto("https://www.easyjet.com", {
        waitUntil: "domcontentloaded",
        timeout: 30000
      });
      await randomDelay(2000, 4000);
  
      console.log(`Navigating to ${url}...`);
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: config.pageLoadTimeout
      });
  
      const title = await page.title();
      console.log(`Loaded: ${title} | ${url}`);
  
      if (title.includes("Access Denied") || title.includes("Blocked")) {
        await saveScreenshot(page, "access-denied");
        throw new Error("Access denied by EasyJet");
      }
  
      const akamaiSuccess = await handleAkamaiChallenge(page);
      if (!akamaiSuccess) {
        console.log("Retrying navigation due to Akamai challenge failure...");
        await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
        const retryAkamaiSuccess = await handleAkamaiChallenge(page);
        if (!retryAkamaiSuccess) {
          await saveScreenshot(page, "akamai-failure");
          throw new Error("Akamai challenge failed after retry");
        }
      }
  
      await mimicHumanActions(page);
  
      try {
        const errorPopup = await page.locator('text="Error"').first();
        if (await errorPopup.isVisible()) {
          const errorId = await page.locator('text=/\\[ID: [a-f0-9-]+\\]/').textContent() || "No ID found";
          console.warn(`EasyJet error popup detected for ${url}: ${errorId}`);
          await saveScreenshot(page, "error-popup");
          throw new Error(`EasyJet server error: ${errorId}`);
        }
      } catch (e) {}
  
      const content = await page.content();
      const blockingKeywords = [
        'captcha',
        'are you human',
        'verify you',
        'access denied',
        'blocked',
        'security check',
        'bot detection',
        'cloudflare',
        'please wait while we verify'
      ];
  
      const hasBlocking = blockingKeywords.some(keyword =>
        content.toLowerCase().includes(keyword.toLowerCase())
      );
  
      if (hasBlocking) {
        if (content.includes("We're very sorry but something has gone wrong")) {
          await saveScreenshot(page, "server-error");
          throw new Error("EasyJet server error detected");
        }
        if (content.includes("Access Denied") || content.includes("Blocked")) {
          await saveScreenshot(page, "access-denied");
          throw new Error("Access denied by EasyJet");
        }
        await saveScreenshot(page, "captcha-block");
        throw new Error("CAPTCHA or block page detected");
      }
  
      console.log("Waiting for API response...");
      const apiResponse = await page.waitForResponse(
        (response) =>
          response.url().includes("/funnel/api/query/search/airports") &&
          response.status() === 200,
        { timeout: config.apiResponseTimeout * 2 } // Increased to handle 25-second delay
      );
  
      const data = await apiResponse.json();
      console.log("API Response Content:", JSON.stringify(data, null, 2));
  
      if (!data || Object.keys(data).length === 0) {
        await saveScreenshot(page, "empty-api-response");
        throw new Error("Empty or invalid API response received");
      }
  
      console.log("✅ API response received successfully!");
      return data;
    } catch (error) {
      if (error.message.includes("Timeout")) {
        await saveScreenshot(page, "timeout");
        throw new Error(`Page load or API timeout: ${error.message}`);
      }
      throw error;
    }
  }

async function crawlWithRetry(page, url, maxRetries = config.maxRetries) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await crawlURL(page, url);
      if (response) return response;
      console.warn(`Attempt ${attempt} failed for ${url}: No API response`);
    } catch (error) {
      console.error(`Error on attempt ${attempt} for ${url}: ${error.message}`);
      const delay = error.message.includes("EasyJet server error") || error.message.includes("Akamai")
        ? [8000 * attempt * config.delays.retryMultiplier, 15000 * attempt * config.delays.retryMultiplier]
        : [3000 * attempt * config.delays.retryMultiplier, 6000 * attempt * config.delays.retryMultiplier];
      await randomDelay(delay[0], delay[1]);
      if (attempt === maxRetries) {
        return { error: `Failed after ${maxRetries} attempts: ${url} - ${error.message}` };
      }
    }
  }
  return null;
}

async function saveResponse(url, response) {
  const { departure, destination, date } = parseURL(url);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${config.outputDir}/${departure}-${destination}-${date}-${timestamp}.json`;
  await fs.writeFile(filename, JSON.stringify({ url, timestamp: new Date().toISOString(), data: response }, null, 2));
  console.log(`Saved response for ${url} to ${filename}`);
}

async function logErrors(results) {
  const errors = results.filter((r) => r.status === "failed");
  if (errors.length) {
    const errorLog = errors.map(({ url, error }) => ({ url, error, timestamp: new Date().toISOString() }));
    await fs.writeFile(`${config.outputDir}/errors.log`, JSON.stringify(errorLog, null, 2));
    const csvContent = errorLog.map(e => `"${e.url.replace(/"/g, '""')}","${e.error.replace(/"/g, '""')}","${e.timestamp}"`).join("\n");
    await fs.writeFile(`${config.outputDir}/errors.csv`, `URL,Error,Timestamp\n${csvContent}`);
    console.log(`Error log saved to ${config.outputDir}/errors.log and errors.csv`);
  }
}

async function crawlAllURLs(urls, concurrency = config.concurrency) {
  await fs.mkdir(config.outputDir, { recursive: true });
  const { browser, context } = await initBrowser();
  const results = [];
  const pages = await Promise.all(
    Array(concurrency).fill().map(() => context.newPage())
  );

  console.log(`Starting crawl with ${concurrency} concurrent browsers...`);

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (url, index) => {
        const page = pages[index % concurrency];
        try {
          const response = await crawlWithRetry(page, url);
          if (response && !response.error) {
            await saveResponse(url, response);
            return { url, status: "success" };
          } else {
            const errorMsg = response && response.error ? response.error : "No API response";
            return { url, status: "failed", error: errorMsg };
          }
        } catch (error) {
          return { url, status: "failed", error: error.message };
        }
      })
    );
    results.push(...batchResults);

    const processed = results.length;
    const successCount = results.filter(r => r.status === "success").length;
    console.log(`Progress: ${processed}/${urls.length} (${((processed/urls.length)*100).toFixed(1)}%) - Success: ${successCount}`);
    await randomDelay(5000, 10000);
  }

  await logErrors(results);
  await context.close();
  await browser.close();
  return results;
}

async function main() {
  console.log("=== EasyJet Data Crawler - Optimized for Speed and Anti-Detection ===");
  console.log(`Configuration: ${config.concurrency} concurrent browsers, ${config.maxRetries} max retries`);
  console.log(`Proxy: ${config.production.enableProxy ? 'Enabled' : 'Disabled'}, Akamai Bypass: Enabled`);

  const urls = await readURLs(config.inputFile);
  console.log(`Found ${urls.length} URLs to process`);

  const urlsToProcess = config.production.maxUrlsPerRun ? urls.slice(0, config.production.maxUrlsPerRun) : urls;
  console.log(`Processing ${urlsToProcess.length} URLs`);

  const startTime = Date.now();
  const results = await crawlAllURLs(urlsToProcess, config.concurrency);
  const endTime = Date.now();

  const successCount = results.filter((r) => r.status === "success").length;
  const failCount = results.filter((r) => r.status === "failed").length;
  const duration = ((endTime - startTime) / 1000 / 60).toFixed(1);

  console.log(`\n=== CRAWL SUMMARY ===`);
  console.log(`Total URLs processed: ${results.length}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Failed: ${failCount}`);
  console.log(`Success rate: ${((successCount / results.length) * 100).toFixed(1)}%`);
  console.log(`Duration: ${duration} minutes`);
  console.log(`Average: ${(results.length / (duration / 60)).toFixed(1)} URLs/minute`);

  if (failCount > 0) {
    console.log("\n=== FAILED URLS (first 10) ===");
    results.filter(r => r.status === "failed").slice(0, 10).forEach(r => {
      console.log(`- ${r.url}`);
      console.log(`  Error: ${r.error}`);
    });
    if (failCount > 10) {
      console.log(`... and ${failCount - 10} more failures`);
    }
    console.log(`\nSee ${config.outputDir}/errors.log and errors.csv for details`);
  }

  const summary = {
    timestamp: new Date().toISOString(),
    totalUrls: results.length,
    successful: successCount,
    failed: failCount,
    successRate: ((successCount / results.length) * 100).toFixed(1),
    duration: `${duration} minutes`,
    urlsPerMinute: (results.length / (duration / 60)).toFixed(1),
    config: {
      concurrency: config.concurrency,
      maxRetries: config.maxRetries,
      headless: config.production.headless,
      akamaiBypass: config.production.enableAkamaiBypass
    }
  };
  await fs.writeFile(`${config.outputDir}/summary.json`, JSON.stringify(summary, null, 2));
  console.log(`\nSummary saved to ${config.outputDir}/summary.json`);
}

main().catch(console.error);