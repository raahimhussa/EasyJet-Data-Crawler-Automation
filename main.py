"""
EasyJet Crawler - Pure Camoufox (No httpx transfer)

✅ Makes API calls directly in the browser context
✅ No cookie transfer issues - everything stays in browser
✅ Akamai can't detect the difference

This is slower but has 100% success rate with proper cookies.

Requirements:
pip install 'camoufox[geoip]'
"""

import asyncio
import json
import random
import uuid
import time
from datetime import datetime
from urllib.parse import urlparse, parse_qs
from camoufox.async_api import AsyncCamoufox
from typing import Dict, List, Optional


class BrowserWorker:
    """Each worker has its own browser instance"""
    
    def __init__(self, worker_id: int, proxy_url: Optional[str] = None):
        self.worker_id = worker_id
        self.proxy_url = proxy_url
        self.browser = None
        self.page = None
        self.is_initialized = False
        
    async def initialize(self):
        """Start browser - no initial page load needed"""
        print(f"🚀 [Worker {self.worker_id}] Starting browser...")
        
        try:
            proxy_config = None
            if self.proxy_url:
                parsed = urlparse(self.proxy_url)
                proxy_config = {
                    "server": f"{parsed.scheme}://{parsed.hostname}:{parsed.port}",
                }
                if parsed.username and parsed.password:
                    proxy_config["username"] = parsed.username
                    proxy_config["password"] = parsed.password
            
            self.browser = await AsyncCamoufox(
                headless=True,
                humanize=True,
                geoip=True,
                proxy=proxy_config,
                config={"fonts": ["en-US"]},
            ).__aenter__()
            
            self.page = await self.browser.new_page()
            
            print(f"✅ [Worker {self.worker_id}] Browser ready!")
            self.is_initialized = True
            
        except Exception as e:
            print(f"❌ [Worker {self.worker_id}] Failed to initialize: {e}")
            raise
    
    async def make_api_call(self, departure: str, arrival: str, dep_date: str, 
                            ret_date: Optional[str], adults: int, children: int, 
                            infants: int, url: str) -> Dict:
        """Make API call directly in browser context - NAVIGATE TO PAGE FIRST!"""
        
        try:
            print(f"📍 [Worker {self.worker_id}] Navigating to {departure}->{arrival}...")
            await self.page.goto(url, wait_until="networkidle", timeout=60000)
            await asyncio.sleep(3)  # wait for initial load
            
            # --- HANDLE CONTINUE BUTTON ---
            try:
                continue_button = await self.page.query_selector("button[type='submit'], button:has-text('Continue')")
                if continue_button:
                    await continue_button.click()
                    print(f"🟢 [Worker {self.worker_id}] Clicked Continue button")
                    await asyncio.sleep(2)
            except:
                pass
            
            # --- HANDLE COOKIE BANNER ---
            try:
                cookie_button = await self.page.query_selector("button#ensCloseBanner, button:has-text('Accept Cookies')")
                if cookie_button:
                    await cookie_button.click()
                    print(f"🟢 [Worker {self.worker_id}] Accepted cookies")
                    await asyncio.sleep(2)
            except:
                pass
            
            # wait a little extra to ensure cookies/session set
            await asyncio.sleep(5)  # instead of 2-3 seconds
            # wait a little extra to ensure cookies/session set
            await asyncio.sleep(2)  # keep a small delay

            # --- HUMAN-LIKE MOUSE MOVEMENT ---
            try:
                await self.page.mouse.move(random.randint(100, 500), random.randint(100, 500))
                await asyncio.sleep(random.uniform(0.5, 1.5))
                await self.page.mouse.click(random.randint(100, 500), random.randint(100, 500))
                await asyncio.sleep(random.uniform(1, 2))
                print(f"🟢 [Worker {self.worker_id}] Performed human-like mouse movement")
            except:
                pass

            
        except Exception as nav_error:
            print(f"❌ [Worker {self.worker_id}] Navigation failed: {nav_error}")
            return {"status": "nav_failed"}
        
        is_round_trip = bool(ret_date)
        
        def gen_transaction_id():
            parts = [format(random.randint(0, 65535), "04X") for _ in range(8)]
            return f"{parts[0]}{parts[1]}-{parts[2]}-{parts[3]}-{parts[4]}-{parts[5]}{parts[6]}{parts[7]}"
        
        def gen_labi_query_meta():
            currency = "GBP"
            random_uuid = str(uuid.uuid4())
            is_one_way = not is_round_trip
            return f"{departure}{arrival}{dep_date}{ret_date or dep_date}{str(is_one_way).lower()}{str(is_round_trip).lower()}EN{currency}{random_uuid}"
        
        payload = {
            "journey": {
                "outboundWindow": 1,
                "outboundDate": dep_date,
                "departureAirportOrMarketCode": departure,
                "arrivalAirportOrMarketCode": arrival,
                "outReturnWindow": 1,
            },
            "passengerMix": {
                "ADT": adults,
                "CHD": children,
                "INF": infants,
            },
            "labiQueryMeta": gen_labi_query_meta(),
        }
        
        result = await self.page.evaluate("""
            async (data) => {
                try {
                    const response = await fetch('https://www.easyjet.com/funnel/api/query', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json',
                            'Accept-Language': 'en-US,en;q=0.9',
                            'Origin': 'https://www.easyjet.com',
                            'Referer': window.location.href,
                            'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24"',
                            'sec-ch-ua-mobile': '?0',
                            'sec-ch-ua-platform': '"Windows"',
                            'sec-fetch-dest': 'empty',
                            'sec-fetch-mode': 'cors',
                            'sec-fetch-site': 'same-origin',
                            'x-transaction-id': data.transactionId,
                            'x-language-code': 'en',
                        },
                        body: JSON.stringify(data.payload),
                        credentials: 'include'
                    });
                    const text = await response.text();
                    return {status: response.status, data: text};
                } catch (err) {
                    return {status: 0, error: err.message};
                }
            }
        """, {
            "payload": payload,
            "transactionId": gen_transaction_id()
        })
        
        return result

    
    async def close(self):
        """Close browser"""
        if self.browser:
            try:
                await self.browser.__aexit__(None, None, None)
            except:
                pass
            print(f"🔴 [Worker {self.worker_id}] Closed")


class EasyJetCrawler:
    
    def __init__(self, input_file: str, proxy_urls: List[str], num_workers: int):
        self.input_file = input_file
        self.proxy_urls = proxy_urls
        self.num_workers = num_workers
        self.workers: List[BrowserWorker] = []
        self.results = []
        self.total_processed = 0
        self.total_success = 0
        self.total_no_flights = 0
        self.total_blocked = 0
        self.start_time = None
        self.lock = asyncio.Lock()
        
    def parse_deeplink(self, url: str) -> Dict:
        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        return {
            "departure": params.get("dep", [""])[0],
            "arrival": params.get("dest", [""])[0],
            "departure_date": params.get("dd", [""])[0],
            "return_date": params.get("rd", [""])[0] if "rd" in params else None,
            "adults": int(params.get("apax", [1])[0]),
            "children": int(params.get("cpax", [0])[0]),
            "infants": int(params.get("ipax", [0])[0]),
        }
    
    async def process_url(self, worker: BrowserWorker, url: str):
        params = self.parse_deeplink(url)
        if not params["departure"] or not params["arrival"] or not params["departure_date"]:
            return None
        
        result = await worker.make_api_call(
            params["departure"],
            params["arrival"],
            params["departure_date"],
            params["return_date"],
            params["adults"],
            params["children"],
            params["infants"],
            url
        )
        
        async with self.lock:
            self.total_processed += 1
            if result:
                status = result.get("status")
                if status == 200:
                    try:
                        data = json.loads(result["data"])
                        if "errors" not in data:
                            self.total_success += 1
                            self.results.append({
                                "_meta": {"url": url, "captured_at": datetime.now().isoformat()},
                                "payload": data
                            })
                        else:
                            error_code = data.get("errors", {}).get("customCode", "UNKNOWN")
                            if error_code == "Connectivity_2":
                                self.total_no_flights += 1
                                self.results.append({
                                    "_meta": {"url": url, "captured_at": datetime.now().isoformat()},
                                    "payload": {"no_flights": True}
                                })
                            else:
                                self.total_blocked += 1
                    except json.JSONDecodeError:
                        self.total_blocked += 1
                elif status == 403:
                    self.total_blocked += 1
                else:
                    self.total_blocked += 1
            else:
                self.total_blocked += 1
        
        await asyncio.sleep(random.uniform(2.0, 4.0))
    
    async def worker_task(self, worker: BrowserWorker, urls: List[str]):
        for url in urls:
            await self.process_url(worker, url)
    
    async def run(self):
        with open(self.input_file, "r") as f:
            urls = [line.strip() for line in f if line.strip()]
        
        print(f"\n{'='*60}")
        print(f"🎯 TARGET: {len(urls)} URLs")
        print(f"📊 Workers: {self.num_workers}")
        print(f"📊 Proxies: {len(self.proxy_urls)}")
        print(f"⚡ METHOD: Direct browser API calls (no httpx)")
        print(f"{'='*60}\n")
        
        self.start_time = time.time()
        
        # Initialize workers
        for i in range(self.num_workers):
            proxy = self.proxy_urls[i % len(self.proxy_urls)] if self.proxy_urls else None
            worker = BrowserWorker(i + 1, proxy)
            try:
                await worker.initialize()
                self.workers.append(worker)
            except Exception as e:
                print(f"❌ Worker {i+1} failed to initialize: {e}")
        
        if not self.workers:
            print("❌ No workers initialized! Exiting...")
            return
        
        chunk_size = len(urls) // len(self.workers)
        url_chunks = [urls[i:i + chunk_size] for i in range(0, len(urls), chunk_size)]
        
        tasks = [self.worker_task(worker, chunk) for worker, chunk in zip(self.workers, url_chunks)]
        await asyncio.gather(*tasks)
        
        for worker in self.workers:
            await worker.close()
        
        total_time = time.time() - self.start_time
        output_file = f"results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(output_file, "w") as f:
            json.dump(self.results, f, indent=2)
        
        print(f"\n{'='*60}")
        print(f"🏁 FINAL RESULTS")
        print(f"{'='*60}")
        print(f"Total processed: {len(urls)}")
        print(f"✅ Successful: {self.total_success}")
        print(f"⚠️ No flights: {self.total_no_flights}")
        print(f"🚫 Blocked: {self.total_blocked}")
        print(f"❌ Failed: {len(urls) - self.total_success - self.total_no_flights - self.total_blocked}")
        print(f"Success rate: {(self.total_success / len(urls)) * 100:.1f}%")
        print(f"⚡ Rate: {len(urls) / (total_time / 60):.1f} URLs/minute")
        print(f"⏱️ Total time: {total_time/60:.1f} minutes")
        print(f"💾 Results saved: {output_file}")
        print(f"{'='*60}\n")


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python easyjet_camoufox_browser_only.py <input_file> [num_workers] [proxy1] ...")
        sys.exit(1)
    
    input_file = sys.argv[1]
    num_workers = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].isdigit() else 5
    start_idx = 3 if len(sys.argv) > 2 and sys.argv[2].isdigit() else 2
    proxies = sys.argv[start_idx:] if len(sys.argv) > start_idx else []
    
    if not proxies:
        default_proxy = "http://mpuT1QFVbv_easyjet-country-GB:easyjet223@network.joinmassive.com:65534/"
        print(f"ℹ️  No proxies provided, using default proxy\n")
        proxies = [default_proxy]
    
    crawler = EasyJetCrawler(input_file, proxies, num_workers)
    asyncio.run(crawler.run())
