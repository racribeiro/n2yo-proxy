# N2YO Hybrid Proxy

## Project Goals

This project provides a local satellite/orbital-object platform built around N2YO data:

- Run a local backend proxy compatible with N2YO route shapes.
- Build and persist a local catalog using `above` sweeps first, then listing backfill.
- Persist TLE data and merged object snapshot in SQLite.
- Serve proxy responses from local data when possible.
- Provide a frontend with filters and a 3D globe that starts empty and renders selected filtered objects.

## Repository Layout

- `backend`: Node.js + Express + TypeScript service with SQLite persistence.
- `frontend`: React + Vite + TypeScript UI.
- `SPECS.md`: product and implementation specification.

## Setup

### Prerequisites

- Node.js 22+
- npm 10+
- Optional: Docker + Docker Compose

### Configure Backend

1. Open `backend/config.json`.
2. Set `n2yo_api_key`.
3. Set `proxy_api_key` (this key is used by frontend and API calls as `apiKey` query param).
4. Adjust `sqlite_db_path`, sweep intervals, and request thresholds if needed.

## Quickstart (Local Dev)

1. Install dependencies:
```bash
npm install
```

2. Start backend:
```bash
npm run dev:backend
```

3. In a second terminal, start frontend:
```bash
npm run dev:frontend
```

4. Open:
- Frontend: `http://localhost:5173`
- Backend docs: `http://localhost:4000/docs`

## Quickstart (Docker Compose)

1. Ensure `backend/config.json` has valid keys.
2. Build and run:
```bash
docker compose up --build
```

3. Open:
- Frontend: `http://localhost:5173`
- Backend: `http://localhost:4000`

## User Manual

### 1. First Login Flow

- Open frontend on `http://localhost:5173`.
- In `Access`, paste your `proxy_api_key` and click `Apply Key`.
- The key is stored in browser local storage and sent as `apiKey` query parameter.

### 2. Run Data Collection

- In `Status`, click `Run Full Sweep` for an immediate sweep.
- Backend also performs scheduled sweeps based on `refresh_interval` and full-sweep freshness timeout.

### 3. Filter and Render on Globe

- Globe starts without satellite markers.
- Use filter panel (text, category, altitude, owner, country, launch date, SAT ID, visibility from home/location).
- Click `Apply Filters And Add To Globe`.
- Matching filtered results are added as selected items and rendered on the globe.

### 4. Configuration Changes

- `Home Location` can be edited in the UI and applied immediately.
- For full config edits (search grid, thresholds, intervals, keys), patch `/api/config` or edit `backend/config.json`.

### 5. Key API Endpoints

All endpoints require `apiKey=<proxy_api_key>` query parameter.

- `GET /api/config`
- `PATCH /api/config`
- `GET /api/status`
- `GET /api/sweeps`
- `GET /api/categories`
- `GET /api/objects`
- `GET /api/tle`
- `GET /rest/v1/satellite/above/...`
- `GET /rest/v1/satellite/tle/...`
- `GET /rest/v1/satellite/positions/...`
- `GET /rest/v1/satellite/visualpasses/...`
- `GET /rest/v1/satellite/radiopasses/...`

## Build and Typecheck

```bash
npm run typecheck
npm run build
```

## Current Notes

- `positions` is computed locally from persisted TLE data.
- `visualpasses` and `radiopasses` routes are scaffolded and currently return empty pass lists while preserving endpoint shape.
- Sweep backfill uses N2YO satellites listing parsing to expand discovered `satid` coverage.
