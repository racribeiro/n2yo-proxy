import React, { useEffect, useMemo, useState } from 'react';

import { fetchCategories, fetchConfig, fetchObjects, fetchStatus, fetchSweeps, patchConfig, runSweepNow } from './api/backend';
import { getBackendUrl, getProxyApiKey, setProxyApiKey } from './api/client';
import { GeneralConfigProvider } from './contexts/GeneralConfigContext';
import { SelectedProvider } from './contexts/SelectedContext';
import GlobePanel from './panels/GlobePanel';
import type { OrbitalObject, SelectedItem } from './types';

const App: React.FC = () => {
  const [proxyKeyInput, setProxyKeyInput] = useState(getProxyApiKey());
  const [n2yoKeyInput, setN2yoKeyInput] = useState('');
  const [config, setConfig] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [objects, setObjects] = useState<OrbitalObject[]>([]);
  const [selected, setSelected] = useState<SelectedItem[]>([]);
  const [sweeps, setSweeps] = useState<Array<Record<string, unknown>>>([]);

  const [showHomeDialog, setShowHomeDialog] = useState(false);

  const [filters, setFilters] = useState({
    q: '',
    category: '',
    minAlt: '',
    maxAlt: '',
    owner: '',
    country: '',
    launchDate: '',
    satid: '',
    visibility: '',
    locLat: '',
    locLng: ''
  });

  const applyFilters = async () => {
    const normalized = {
      q: filters.q.trim(),
      category: filters.category.trim(),
      minAlt: filters.minAlt.trim(),
      maxAlt: filters.maxAlt.trim(),
      owner: filters.owner.trim(),
      country: filters.country.trim(),
      launchDate: filters.launchDate.trim(),
      satid: filters.satid.trim(),
      visibility: filters.visibility.trim(),
      locLat: filters.locLat.trim(),
      locLng: filters.locLng.trim()
    };

    const query: Record<string, string | number | undefined> = {
      q: normalized.q || undefined,
      category: normalized.category || undefined,
      minAlt: normalized.minAlt ? Number(normalized.minAlt) : undefined,
      maxAlt: normalized.maxAlt ? Number(normalized.maxAlt) : undefined,
      owner: normalized.owner || undefined,
      country: normalized.country || undefined,
      launchDate: normalized.launchDate || undefined,
      satid: normalized.satid ? Number(normalized.satid) : undefined,
      visibility: normalized.visibility || undefined,
      locLat: normalized.locLat ? Number(normalized.locLat) : undefined,
      locLng: normalized.locLng ? Number(normalized.locLng) : undefined
    };

    const payload = await fetchObjects(query);
    setObjects(payload.objects);
  };

  const toggleObjectOnGlobe = (obj: OrbitalObject) => {
    if (typeof obj.satlat !== 'number' || typeof obj.satlng !== 'number') return;
    setSelected((prev) => {
      const idx = prev.findIndex((s) => s.entity_type === 'satellite' && s.id === obj.satid);
      if (idx >= 0) {
        return prev.filter((_, i) => i !== idx);
      }
      return [
        ...prev,
        {
          id: obj.satid,
          entity_type: 'satellite',
          name: obj.satname,
          latitude: obj.satlat,
          longitude: obj.satlng,
          altitudeKm: typeof obj.satalt === 'number' ? obj.satalt : undefined
        }
      ];
    });
  };

  const refreshAll = async () => {
    const [cfg, st, cats, sw] = await Promise.all([fetchConfig(), fetchStatus(), fetchCategories(), fetchSweeps()]);
    setConfig(cfg);
    setStatus(st);
    setCategories(cats.categories);
    setSweeps(sw.sweeps);
  };

  useEffect(() => {
    refreshAll().catch(() => undefined);
  }, []);

  const home = useMemo(
    () => ({
      latitude: config?.home_location?.latitude ?? 0,
      longitude: config?.home_location?.longitude ?? 0
    }),
    [config]
  );

  const saveProxyKey = async () => {
    setProxyApiKey(proxyKeyInput);
    await refreshAll();
  };

  const saveN2yoKey = async () => {
    await patchConfig({ n2yo_api_key: n2yoKeyInput });
    setN2yoKeyInput('');
    await refreshAll();
  };

  const saveHome = async () => {
    await patchConfig({
      home_location: {
        latitude: Number(home.latitude),
        longitude: Number(home.longitude),
        altitude: 0
      }
    });
    await refreshAll();
  };

  return (
    <GeneralConfigProvider value={home}>
      <SelectedProvider items={selected} setItems={setSelected}>
        <div className="app-grid">
          <aside className="sidebar">
            <div className="sidebar-top">
              <h1>Orbit Satellite Tracker</h1>

              <div className="panel">
                <h2>Status</h2>
                <p className="small">Sweeper: {status?.running ? 'running' : 'idle'}</p>
                <p className="small">Sweep stale: {status?.stale ? 'yes' : 'no'}</p>
                <p className="small">Objects: {status?.objectCount ?? 0}</p>
                <p className="small">TLEs: {status?.tleCount ?? 0}</p>
                <button onClick={() => runSweepNow().then(refreshAll)}>Run Full Sweep</button>
              </div>

              <div className="panel">
                <h2>Filters</h2>
                <div className="row"><label>Text</label><input value={filters.q} onChange={(e) => setFilters((s) => ({ ...s, q: e.target.value }))} /></div>
                <div className="row"><label>Category</label>
                  <select value={filters.category} onChange={(e) => setFilters((s) => ({ ...s, category: e.target.value }))}>
                    <option value="">All</option>
                    {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="grid2">
                  <div className="row"><label>Min Alt</label><input value={filters.minAlt} onChange={(e) => setFilters((s) => ({ ...s, minAlt: e.target.value }))} /></div>
                  <div className="row"><label>Max Alt</label><input value={filters.maxAlt} onChange={(e) => setFilters((s) => ({ ...s, maxAlt: e.target.value }))} /></div>
                </div>
                <div className="grid2">
                  <div className="row"><label>Owner</label><input value={filters.owner} onChange={(e) => setFilters((s) => ({ ...s, owner: e.target.value }))} /></div>
                  <div className="row"><label>Country</label><input value={filters.country} onChange={(e) => setFilters((s) => ({ ...s, country: e.target.value }))} /></div>
                </div>
                <div className="grid2">
                  <div className="row"><label>Launch Date</label><input value={filters.launchDate} onChange={(e) => setFilters((s) => ({ ...s, launchDate: e.target.value }))} /></div>
                  <div className="row"><label>SAT ID</label><input value={filters.satid} onChange={(e) => setFilters((s) => ({ ...s, satid: e.target.value }))} /></div>
                </div>
                <div className="row">
                  <label>Visibility</label>
                  <select value={filters.visibility} onChange={(e) => setFilters((s) => ({ ...s, visibility: e.target.value }))}>
                    <option value="">None</option>
                    <option value="home">From home</option>
                    <option value="location">From location</option>
                  </select>
                </div>
                <div className="grid2">
                  <div className="row"><label>Loc Lat</label><input value={filters.locLat} onChange={(e) => setFilters((s) => ({ ...s, locLat: e.target.value }))} /></div>
                  <div className="row"><label>Loc Lng</label><input value={filters.locLng} onChange={(e) => setFilters((s) => ({ ...s, locLng: e.target.value }))} /></div>
                </div>
                <button onClick={applyFilters}>Apply Filters And Add To Globe</button>
              </div>

              <div className="panel">
                <h2>Filtered Objects ({objects.length})</h2>
                <div className="filtered-list">
                  {objects.slice(0, 80).map((o) => (
                    <div
                      role="button"
                      tabIndex={0}
                      className={`filtered-list-item ${
                        selected.some((s) => s.id === o.satid && s.entity_type === 'satellite') ? 'is-active' : ''
                      }`}
                      key={o.satid}
                      onClick={() => toggleObjectOnGlobe(o)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleObjectOnGlobe(o);
                        }
                      }}
                      title="Toggle on globe"
                    >
                      <span className="filtered-list-name">{o.satname}</span>
                      <span className="filtered-list-id">#{o.satid}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="panel">
                <h2>Recent Sweeps</h2>
                <div className="items">
                  {sweeps.slice(0, 8).map((s, idx) => (
                    <div className="item" key={idx}>
                      <span>{String(s.status)}</span>
                      <span>{String(s.discoveredCount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="sidebar-bottom">
              <div className="panel">
                <h2>Options</h2>
                <button className="secondary" onClick={() => setShowHomeDialog(true)}>Home Location</button>
              </div>

              <div className="panel">
                <h2>OpenAPI & Links</h2>
                <div className="menu-links">
                  <a href={`${getBackendUrl()}/docs`} target="_blank" rel="noreferrer">OpenAPI Docs</a>
                </div>
              </div>
            </div>
          </aside>

          <section className="globe-wrap">
            <GlobePanel />
          </section>
        </div>


        {showHomeDialog && (
          <div className="dialog-backdrop" onClick={() => setShowHomeDialog(false)}>
            <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
              <h2>Home Location</h2>
              <div className="grid2">
                <div className="row">
                  <label>Latitude</label>
                  <input
                    value={home.latitude}
                    onChange={(e) =>
                      setConfig((v: any) => ({
                        ...(v ?? {}),
                        home_location: {
                          ...(v?.home_location ?? {}),
                          latitude: Number(e.target.value)
                        }
                      }))
                    }
                  />
                </div>
                <div className="row">
                  <label>Longitude</label>
                  <input
                    value={home.longitude}
                    onChange={(e) =>
                      setConfig((v: any) => ({
                        ...(v ?? {}),
                        home_location: {
                          ...(v?.home_location ?? {}),
                          longitude: Number(e.target.value)
                        }
                      }))
                    }
                  />
                </div>
              </div>
              <button onClick={saveHome}>Save Home Location</button>
              <button className="secondary" onClick={() => setShowHomeDialog(false)}>Close</button>
            </div>
          </div>
        )}
      </SelectedProvider>
    </GeneralConfigProvider>
  );
};

export default App;
