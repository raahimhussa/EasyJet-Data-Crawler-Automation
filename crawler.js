const { chromium } = require("playwright");
const fs = require("fs").promises;

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

async function initBrowser() {
  const browser = await chromium.launch({
    headless: true,
  });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 },
  });
  return { browser, context };
}

async function crawlURL(page, url) {
  let apiResponse = null;
  await page.route("**/funnel/api/query", async (route) => {
    const response = await route.fetch();
    apiResponse = await response.json();
    await route.fulfill({ response });
  });
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  return apiResponse;
}

async function crawlWithRetry(page, url, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await crawlURL(page, url);
      if (response) return response;
      console.warn(`Attempt ${attempt} failed for ${url}`);
    } catch (error) {
      console.error(`Error on attempt ${attempt} for ${url}: ${error.message}`);
      if (attempt === maxRetries)
        throw new Error(`Failed after ${maxRetries} attempts: ${url}`);
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
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

async function crawlAllURLs(urls, concurrency = 3) {
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
          await saveResponse(url, response);
          return { url, status: "success" };
        } catch (error) {
          return { url, status: "failed", error: error.message };
        }
      })
    );
    results.push(...batchResults);
    await new Promise((resolve) =>
      setTimeout(resolve, Math.random() * 2000 + 1000)
    );
  }

  await logErrors(results);
  await context.close();
  await browser.close();
  return results;
}

async function main() {
  const urls = await readURLs("jetjobs.txt");
  console.log(`Processing ${urls.length} URLs`);
  const testURLs = urls.slice(0, 5); // Test with first 5 URLs
  const results = await crawlAllURLs(testURLs, 3);
  console.log("Crawl completed:", results);
}

main().catch(console.error);
