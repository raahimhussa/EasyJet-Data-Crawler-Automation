module.exports = {
  // Crawler settings
  concurrency: 1, // Keep at 1 to avoid detection
  maxRetries: 3, // Maximum retry attempts per URL
  
  // Timeouts
  pageLoadTimeout: 60000, // Increased timeout for Akamai challenges
  apiResponseTimeout: 45000, // Increased API timeout
  
  // Delays (in milliseconds) - More human-like
  delays: {
    min: 3000, // Increased minimum delay
    max: 8000, // Increased maximum delay
    retryMultiplier: 3, // More aggressive retry delays
  },
  
  // Browser settings - Enhanced stealth
  browser: {
    headless: false, // Keep visible for Akamai challenges
    slowMo: 300, // Increased slow motion
    viewport: { width: 1920, height: 1080 }, // Larger viewport
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  },
  
  // Proxy settings (enabled for anti-detection)
  proxy: {
    server: "http://gw.dataimpulse.com:823",
    username: "ed63643ab6c7d5f00fa2",
    password: "9d7a34793c919695",
  },
  
  // File paths
  inputFile: "jetjobs.txt",
  outputDir: "output",
  
  // Logging
  logLevel: "info", // debug, info, warn, error
  
  // Production settings
  production: {
    enableProxy: true, // Enable proxy for anti-detection
    headless: false, // Keep visible for Akamai
    saveScreenshots: true, // Save screenshots on errors for debugging
    maxUrlsPerRun: 5, // Start with very small batch for testing
    enableAkamaiBypass: true, // Enable Akamai-specific bypass techniques
  }
}; 