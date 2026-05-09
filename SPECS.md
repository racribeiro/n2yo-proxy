### **Project: N2YO Hybrid Proxy & Local Orbital Object Registry**

**Context:** Build a Node.js backend and a TypeScript/Vite frontend to act as an intelligent, caching proxy for N2YO.com. The goal is to bypass the single-location limitation of N2YO’s `above` API by sweeping a configured global grid, merging the returned objects into a local registry, persisting a local TLE catalog, and exposing a local proxy that can answer N2YO-style requests from local data with full route and response fidelity whenever possible.

**Coverage Goal:** The target dataset is the full set of orbital objects shown on [N2YO’s satellites listing](https://www.n2yo.com/satellites/), not just active satellites. At review time, that page reported **34,060 objects as of 7-May-2026**, spanning satellites, debris, and rocket bodies.

---

#### **1. Backend (Node.js + Express)**

* **Registry Model:** Maintain an in-memory `objects` registry keyed by `satid`. This is a current merged snapshot only, not a historical database.
* **TLE Catalog:** Maintain a persistent local TLE store keyed by `satid`. This store must survive restarts and is the highest-priority local dataset in the system.
* **Snapshot Semantics:** Every merged object should store the latest upstream fields plus a local `lastSeenAt` timestamp. The backend should not retain per-object history beyond the current record and its most recent observation time.
* **Persistence:** Use SQLite for local persistence. At minimum, the SQLite database must persist the TLE catalog, category enrichment data, sweep metadata, and freshness timestamps across restarts. The live merged object snapshot may still be rebuilt in memory from persisted and refreshed data.
* **Core Logic:** Implement a `DataRefresher` service that iterates the configured `search_locations` on each `refresh_interval`, calls the upstream N2YO `above` API, and merges the results into the local registry using `satid` as the deduplication key.
* **Discovery Strategy:** Seed the local object universe from `above` sweeps first because they produce the most immediately useful orbital set, then backfill against the broader N2YO satellites listing to discover additional `satid` values needed for full coverage.
* **Full Sweep Freshness:** Track `lastFullSweepAt` and enforce a full-sweep freshness timeout. The default maximum age for a completed full sweep is **once every 7 days**.
* **Startup Bootstrap:** On service startup, load the persisted TLE catalog first. Then identify missing or stale `satid` entries and queue upstream `tle` fetches until the local TLE catalog is complete for the known object set, subject to the configured upstream request thresholds.
* **TLE Parsing:** For each upstream TLE response, persist both the raw `tle` string and a parsed representation split into `line1` and `line2`. The system should also parse the TLE into normalized orbital elements needed by the local computation layer.
* **Local Orbital Computation:** Treat TLE as the primary source for computing local proxy responses such as `positions`, `visualpasses`, and `radiopasses`. These are required parts of the version 1 proxy, not optional future work. Upstream calls for those verbs should be used only when local data is missing, stale, or explicitly being cross-checked.
* **Fetch Budgeting:** Add an upstream request planner that is aware of request thresholds by verb and time window. When the planned upstream work exceeds the remaining budget for the active window, it should defer the remaining fetches into later windows rather than failing the sweep.
* **Config Management:** Store runtime configuration in `config.json` with separate fields for:
  * `home_location`: the user’s mutable location for UI defaults and user-facing tracking flows.
  * `search_locations`: preset sweep coordinates used only by the refresher.
  * `n2yo_api_key`: upstream N2YO key, write-only through the app.
  * `proxy_api_key`: local proxy key, write-only through the app.
  * `sqlite_db_path`
  * `tle_max_age_hours`
  * `full_sweep_max_age_hours`
  * `request_threshold_window_minutes`
  * `request_thresholds_by_verb`
  * `refresh_interval`
* **Default Upstream Thresholds:** The config model should support per-verb limits matching the upstream N2YO request ceilings:
  * `tle`: 1000
  * `positions`: 1000
  * `visualpasses`: 100
  * `radiopasses`: 100
  * `above`: 100
* **Config API:** Expose `GET /api/config` and `PATCH /api/config`.
  * `GET /api/config` must never return `n2yo_api_key` or `proxy_api_key`.
  * `PATCH /api/config` may update both keys and non-secret fields, applies changes immediately to the running system, and must not echo the secret values back.
  * The read response should expose non-secret settings plus presence flags such as `hasN2yoApiKey` and `hasProxyApiKey`.
* **Mock N2YO API:** Expose local N2YO-style endpoints that prefer local data over upstream fetches:
  * `GET /rest/v1/satellite/above/{observer_lat}/{observer_lng}/{observer_alt}/{search_radius}/{category_id}/&apiKey={proxy_api_key}` with full route and JSON schema fidelity to N2YO, served from the local cached sweep data.
  * `GET /rest/v1/satellite/tle/{id}&apiKey={proxy_api_key}` served from the persisted local TLE catalog.
  * `GET /rest/v1/satellite/positions/{id}/{observer_lat}/{observer_lng}/{observer_alt}/{seconds}/&apiKey={proxy_api_key}` computed from local TLE data whenever possible.
  * `GET /rest/v1/satellite/visualpasses/{id}/{observer_lat}/{observer_lng}/{observer_alt}/{days}/{min_visibility}/&apiKey={proxy_api_key}` computed from local TLE data whenever possible.
  * `GET /rest/v1/satellite/radiopasses/{id}/{observer_lat}/{observer_lng}/{observer_alt}/{days}/{min_elevation}/&apiKey={proxy_api_key}` computed from local TLE data whenever possible.
  * The local proxy should not enforce the upstream N2YO per-verb request limits because it serves from the in-memory dataset rather than forwarding each call upstream.
* **Registry API:** Expose `GET /api/objects` to return the full merged current snapshot, including `lastSeenAt`, and allow filtering by category when category metadata is available.
* **TLE API:** Expose an internal/admin endpoint such as `GET /api/tle` or `GET /api/tle/:satid` for inspection of the persisted TLE catalog, including freshness metadata like `fetchedAt` and `expiresAt`.
* **Status APIs:** Expose `GET /api/status`, `GET /api/sweeps`, and `GET /api/categories` for frontend health, sweep history, and filter metadata.
* **Category Enrichment:** Categories are upstream-driven and should be discovered from N2YO API/category inspection requests rather than invented locally. Persist the discovered category mapping in SQLite so category filters do not need to be recomputed from scratch on every restart.
* **Stale Data Policy:** If a required TLE or derived orbit dataset is stale, the proxy should block the request, refresh the upstream data on demand, and only then respond. If that refresh cannot complete because of upstream quota exhaustion or repeated `429` failures, return a stale-data-specific error rather than silently serving stale results.
* **Authentication:** All `/api/*` endpoints and all `/rest/v1/satellite/*` proxy endpoints must require the local `proxy_api_key` using the exact N2YO-style `apiKey` query parameter. The proxy key is stored in config, can be patched, and cannot be retrieved through any read endpoint.
* **Documentation:** Auto-generate Swagger/OpenAPI documentation at `/docs`. The docs should describe the write-only secret behavior and the proxy key requirement.

#### **2. Frontend (React/TypeScript + Vite + Tailwind + Lucide)**

* **Layout:**
* **Sidebar:** Use Lucide icons such as `Satellite`, `Settings`, `Database`, and `FileJson`.
* **3D Globe Panel:** The frontend should provide a movable 3D globe panel that renders orbital objects on demand. Users must be able to drag to rotate the globe, zoom in and out, and inspect the live global distribution visually.
* **Globe Filter Flow:** The globe should load without satellite markers by default. Users then choose filters and explicitly add matching objects to the map.
* **Object List:** Show the current merged object snapshot in a clean Tailwind table or card view. Surface N2YO category labels when available and include `lastSeenAt` in the detail view.
* **Filter Controls:** Provide filters for category and other supported facets so users can decide which subsets are rendered on the globe before markers are added.
* **Version 1 Filters:** Support at least: text search, altitude band, visibility from `home_location`, visibility from an arbitrary location, launch date, owner, country, category, and explicit object ID selection.
* **TLE Visibility:** Provide an operator-facing way to inspect TLE availability, freshness, and bootstrap progress because TLE completeness is a primary system health signal.
* **Config Panel (Bottom Left):**
* A settings view should allow editing non-secret config plus updating write-only secrets without ever revealing existing key values.
* Include a sync status indicator showing the last completed global sweep, sweep staleness against the weekly timeout, current refresher health, and TLE bootstrap completeness.
* **Dev Tools:** Provide direct links to the raw JSON output and Swagger UI.

#### **3. Constraints & Technical Specs**

* **Language:** Strict TypeScript for both backend and frontend.
* **State Management:** Use a simple store such as Zustand or React Query on the frontend.
* **Resiliency:** Respect the configured upstream request thresholds by verb and time window to avoid N2YO key banning. Apply exponential backoff on `429` responses, track sweep failures in status metadata, split large upstream jobs across multiple windows when needed, always prioritize completion and refresh of the persistent TLE catalog, and detect when the full-sweep age exceeds the weekly timeout.
* **Formatting:** Use Tailwind’s `slate` or `zinc` palette for a dark aerospace-style interface.

---

### **Search Grid Strategy**

* `home_location` and `search_locations` are different concepts and should remain separate in both config and API behavior.
* `search_locations` should be a preset global sweep grid with points spaced **30 degrees apart in latitude and longitude**.
* The sweep grid exists to systematically query N2YO and build a near-complete local registry of all orbital objects visible across the globe, rather than reflecting the user’s own location.
* The implementation may canonicalize pole coordinates to avoid redundant calls where longitude has no practical meaning at `90` or `-90` latitude.

---

### **Resolved Decisions**

1. **Persistence:** SQLite is the required local persistence layer. TLEs, categories, sweep metadata, and the last merged object snapshot must survive restarts.
2. **Deduplication Key:** `satid` is the canonical identity in the local registry.
3. **Config Split:** `home_location` is the user-facing mutable location; `search_locations` is the preset global sweep grid.
4. **Mock API Fidelity:** The local `above` endpoint must mirror N2YO’s route and response schema fully.
5. **Secret Handling:** `GET /api/config` must not return either `n2yo_api_key` or `proxy_api_key`.
6. **Staleness Policy:** Objects should remain in the current snapshot with a `lastSeenAt` field.
7. **History Scope:** Keep only the current merged snapshot, not historical trajectories.
8. **Category Source:** Categories should come from N2YO, not from local relabeling.
9. **Security Scope:** All `/api/*` and `/rest/v1/satellite/*` endpoints require the local `proxy_api_key`.
10. **Coverage Goal:** The intended completeness target is the object set reported on N2YO’s satellites listing page.
11. **Full Sweep Timeout:** A completed full sweep should be no older than 7 days by default.
12. **Version 1 Proxy Scope:** `above`, `tle`, `positions`, `visualpasses`, and `radiopasses` are all required in version 1.
13. **Stale Data Behavior:** Stale TLE-backed responses should block until refreshed on request.
14. **Frontend Globe Behavior:** The globe starts empty of satellite markers and only renders objects after the user applies filters. Matching selected results are then added to the globe.
15. **Frontend Status APIs:** `/api/status`, `/api/sweeps`, and `/api/categories` are required for the frontend.
16. **Config Apply Behavior:** `PATCH /api/config` applies non-secret changes immediately.
17. **Refresh Failure Behavior:** If a blocking refresh cannot complete because of upstream limits, the backend returns a stale-data-specific error.
18. **Version 1 Filter Set:** Text, altitude, visibility from `home_location`, visibility from arbitrary location, launch date, owner, country, category, and ID filters are required.
19. **Initial Discovery Order:** Build the local universe from `above` sweeps first, then backfill from the N2YO satellites listing for completeness.
20. **Proxy Auth Shape:** `/rest/v1/satellite/*` uses the exact N2YO-style `apiKey` query parameter rather than header-only auth.

---

### **Implementation Notes**

* The current N2YO REST API documentation states that authentication is passed as `&apiKey=...` at the end of the URL and that upstream request limits are per verb:
  * `tle`: 1000
  * `positions`: 1000
  * `visualpasses`: 100
  * `radiopasses`: 100
  * `above`: 100
* A 30-degree sweep grid is compatible with a bounded hourly job, but category enrichment needs care: N2YO’s `above` response returns the category at the request level, not as a per-object field in the `above` array.
* TLE completeness is more important than keeping the in-memory object snapshot warm. On startup, the system should prefer loading and validating the local TLE catalog from SQLite before spending upstream budget on non-TLE requests.
* The upstream TLE payload is a two-line element string separated by `\r\n`, for example:
  * line 1: `1 25544U 98067A   18077.09047010  .00001878  00000-0  35621-4 0  9999`
  * line 2: `2 25544  51.6412 112.8495 0001928 208.4187 178.9720 15.54106440104358`
* The implementation should parse and persist the raw TLE plus extracted orbital fields so that local orbit computation does not depend on reparsing the raw string on every request.
* The fetch planner should treat `tle` completion as a first-class queue with its own freshness lifecycle. Missing or stale TLE entries should be refreshed before other derived-response work.
* The fetch planner should treat the sweep as a queued workload that can be paged across time windows when the `above` budget is insufficient to finish the full grid in one pass.
* The initial object-universe builder should favor `above`-discovered objects first, then reconcile against the larger N2YO listing so early system startup is driven by the most operationally relevant set.
* Category filters should be backed by persisted upstream category inspection data, not by locally invented labels.
* The last merged object snapshot should be persisted so the frontend can load meaningful state before the next sweep completes.
* The local proxy itself has no equivalent per-verb quota because it should answer from the cached local dataset and persisted TLE catalog rather than spending an upstream transaction for each client request.

---
