# Backend Service

## Overview

Node.js + Express + TypeScript backend that:

- Proxies N2YO-compatible routes under `/rest/v1/satellite/*`
- Maintains local object/TLE state with SQLite
- Runs sweeps and exposes operational APIs under `/api/*`

## Local Run

1. Copy config template:
```bash
cp config.example.json config.json
```

2. Set secrets in `config.json`:
- `n2yo_api_key`
- `proxy_api_key`

3. Install dependencies and run:
```bash
npm install
npm run dev
```

Default URL: `http://localhost:4000`

## Build

```bash
npm run typecheck
npm run build
npm run start
```

## Config

Main config file: `backend/config.json` (ignored by git).

Template file: `backend/config.example.json`.

Important fields:

- `home_location`
- `search_locations`
- `n2yo_api_key`
- `proxy_api_key`
- `request_thresholds_by_verb`
- `refresh_interval`

## Key Endpoints

Requires `apiKey=<proxy_api_key>`:

- `GET /api/status`
- `GET /api/sweeps`
- `GET /api/config`
- `PATCH /api/config`
- `GET /api/objects`
- `GET /api/tle`
- `GET /api/tle/:satid`
- `GET /rest/v1/satellite/above/...`
- `GET /rest/v1/satellite/tle/...`
- `GET /rest/v1/satellite/positions/...`

## Notes

- `config.json` is intentionally not tracked to avoid leaking keys.
- Local database defaults to `backend/data/n2yo.db`.
- Swagger docs are available at `/docs`.
