# EasyJet Flight Data Crawler

A web crawler for extracting EasyJet flight data using Camoufox browser automation.

## Installation

```bash
pip install 'camoufox[geoip]'
```

## Usage

### Basic Usage (Default Proxy)

```bash
python main.py jetjobs.txt
```

### Custom Number of Workers

```bash
python main.py jetjobs.txt 10
```

### With Custom Proxies

```bash
python main.py jetjobs.txt 5 http://user:pass@proxy1.com:8080 http://user:pass@proxy2.com:8080
```

## Command Format

```bash
python main.py <input_file> [num_workers] [proxy1] [proxy2] ...
```

**Arguments:**
- `input_file` - Required. Text file with EasyJet deep links (one per line)
- `num_workers` - Optional. Number of concurrent workers (default: 5)
- `proxy1, proxy2, ...` - Optional. Proxy URLs for rotation

## Input File Format

Text file with EasyJet booking URLs (one per line):

```
https://www.easyjet.com/deeplink?lang=EN&dep=LGW&dest=FAO&dd=2025-12-31&apax=1&cpax=0&ipax=0
https://www.easyjet.com/deeplink?lang=EN&dep=MAN&dest=CFU&dd=2025-10-23&apax=1&cpax=0&ipax=0
https://www.easyjet.com/deeplink?lang=EN&dep=BRS&dest=ACE&dd=2025-11-05&apax=1&cpax=0&ipax=0
```

Example: `jetjobs.txt` (16,625 URLs included)

## Output

Results saved to `dataset/` folder, organized by route:
```
dataset/{departure}-{arrival}-{RT|OW}-{date}/
```
