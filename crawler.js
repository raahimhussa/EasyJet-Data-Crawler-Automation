const fs = require("fs").promises;
const { chromium } = require("playwright");

function randomDelay(min = 500, max = 2000) {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.random() * (max - min) + min)
  );
}

async function readURLs(filePath) {
  const data = await fs.readFile(filePath, "utf-8");
  return data
    .split("\n")
    .filter((url) => url.trim().startsWith("https://www.easyjet.com/deeplink"));
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

// "http://ed63643ab6c7d5f00fa2:9d7a34793c919695@gw.dataimpulse.com:823"
// https://api.ipify.org/
async function initBrowser() {
  // No proxy for home IP testing. To re-enable proxy, add the 'proxy' option here.
  const browser = await chromium.launch({
    headless: false,
    slowMo: 100,
    proxy: {
      server: "http://gw.dataimpulse.com:823",
      username: "ed63643ab6c7d5f00fa2",
      password: "9d7a34793c919695",
    },
  });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 },
  });
  return { browser, context };
}

async function mimicHumanActions(page) {
  // Accept cookies if the button is present
  try {
    await page.click('button:has-text("Accept Cookies")', { timeout: 3000 });
    await randomDelay(500, 1500);
  } catch (e) {}
  // Click "Continue" on welcome dialog if present
  try {
    await page.click('button:has-text("Continue")', { timeout: 3000 });
    await randomDelay(500, 1500);
  } catch (e) {}
  // Move mouse randomly
  try {
    await page.mouse.move(Math.random() * 800 + 200, Math.random() * 300 + 200);
    await randomDelay(300, 1000);
  } catch (e) {}
  // Scroll down and up
  try {
    await page.mouse.wheel(0, 200);
    await randomDelay(300, 1000);
    await page.mouse.wheel(0, -200);
    await randomDelay(300, 1000);
  } catch (e) {}
}

async function crawlURL(page, url) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  const title = await page.title();
  console.log(`Loaded: ${title} | ${url}`);
  await mimicHumanActions(page);
  try {
    const apiResponse = await page.waitForResponse(
      (response) =>
        response.url().includes("/funnel/api/query") &&
        response.status() === 200,
      { timeout: 30000 }
    );
    const data = await apiResponse.json();
    return data;
  } catch (e) {
    const content = await page.content();
    if (/captcha|are you human|verify you|error/i.test(content)) {
      throw new Error("CAPTCHA or block page detected");
    }
    console.warn(`No API response for ${url}`);
    return null;
  }
}

async function crawlWithRetry(page, url, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await crawlURL(page, url);
      if (response) return response;
      console.warn(`Attempt ${attempt} failed for ${url}: No API response`);
    } catch (error) {
      console.error(`Error on attempt ${attempt} for ${url}: ${error.message}`);
      if (attempt === maxRetries)
        return {
          error: `Failed after ${maxRetries} attempts: ${url} - ${error.message}`,
        };
      await randomDelay(2000 * attempt, 3000 * attempt);
    }
  }
  return null;
}

async function saveResponse(url, response) {
  const { departure, destination, date } = parseURL(url);
  const filename = `output/${departure}-${destination}-${date}.json`;
  await fs.writeFile(filename, JSON.stringify(response, null, 2));
  console.log(`Saved response for ${url} to ${filename}`);
}

async function logErrors(results) {
  const errors = results.filter((r) => r.status === "failed");
  if (errors.length) {
    await fs.writeFile("output/errors.log", JSON.stringify(errors, null, 2));
  }
}

async function crawlAllURLs(urls, concurrency = 1) {
  await fs.mkdir("output", { recursive: true });
  const { browser, context } = await initBrowser();
  const results = [];
  const pages = await Promise.all(
    Array(concurrency)
      .fill()
      .map(() => context.newPage())
  );

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
            const errorMsg =
              response && response.error ? response.error : "No API response";
            return { url, status: "failed", error: errorMsg };
          }
        } catch (error) {
          return { url, status: "failed", error: error.message };
        }
      })
    );
    results.push(...batchResults);
    await randomDelay(1000, 3000);
  }

  await logErrors(results);
  await context.close();
  await browser.close();
  return results;
}

async function main() {
  const urls = await readURLs("jetjobs.txt");
  console.log(`Processing ${urls.length} URLs`);
  const testURLs = urls.slice(0, 3); // Test with first 3 URLs
  const results = await crawlAllURLs(testURLs, 1);
  const successCount = results.filter((r) => r.status === "success").length;
  const failCount = results.filter((r) => r.status === "failed").length;
  console.log(
    `Crawl completed. Success: ${successCount}, Failed: ${failCount}`
  );
  if (failCount > 0) {
    console.log("See output/errors.log for details.");
  }
}

main().catch(console.error);
