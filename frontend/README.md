# Frontend Service

## Overview

React + Vite + TypeScript UI for:

- Access/config controls
- Sweep/status dashboards
- Filtered object list
- Interactive 3D globe with live TLE propagation and orbit visualization

## Local Run

```bash
npm install
npm run dev
```

Default URL: `http://localhost:5173`

## Build

```bash
npm run typecheck
npm run build
npm run preview
```

## Backend Connection

The UI calls backend with `apiKey` query parameter.

In production, the baked frontend calls the same origin that served the app.

In local Vite development, set `VITE_BACKEND_URL` in the repo `.env` file.

The proxy API key is stored in browser local storage.

## Main Features

- Globe layers toggle (Sun, Moon, orbit bands, ISS, selected)
- Satellite hover labels
- Click-to-select satellite details
- Orbit rendering with configurable past/future range (log-scaled sliders)
- `LOG`/`REAL` distance scaling toggle

## Notes

- Frontend expects backend `/api/*` and `/rest/v1/satellite/*` routes.
- If globe appears empty, verify backend URL and proxy key first.
