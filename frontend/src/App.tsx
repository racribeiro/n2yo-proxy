import React, { useEffect, useMemo, useState } from 'react';

import { fetchCategories, fetchConfig, fetchObjects, fetchStatus, fetchSweeps, patchConfig, runSweepNow } from './api/backend';
import { getBackendUrl, getProxyApiKey, setBackendUrl, setProxyApiKey } from './api/client';
import { GeneralConfigProvider } from './contexts/GeneralConfigContext';
import { SelectedProvider } from './contexts/SelectedContext';
import GlobePanel from './panels/GlobePanel';
import type { OrbitalObject, SelectedItem } from './types';

const App: React.FC = () => {
  const [proxyKeyInput, setProxyKeyInput] = useState(getProxyApiKey());
  const [n2yoKeyInput, setN2yoKeyInput] = useState('');
  const [backendUrlInput, setBackendUrlInput] = useState(getBackendUrl());
  const [config, setConfig] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [objects, setObjects] = useState<OrbitalObject[]>([]);
  const [selected, setSelected] = useState<SelectedItem[]>([]);
  const [sweeps, setSweeps] = useState<Array<Record<string, unknown>>>([]);

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
    const query: Record<string, string | number | undefined> = {
      q: filters.q || undefined,
      category: filters.category || undefined,
      minAlt: filters.minAlt ? Number(filters.minAlt) : undefined,
      maxAlt: filters.maxAlt ? Number(filters.maxAlt) : undefined,
      owner: filters.owner || undefined,
      country: filters.country || undefined,
      launchDate: filters.launchDate || undefined,
      satid: filters.satid ? Number(filters.satid) : undefined,
      visibility: filters.visibility || undefined,
      locLat: filters.locLat ? Number(filters.locLat) : undefined,
      locLng: filters.locLng ? Number(filters.locLng) : undefined
    };

    const payload = await fetchObjects(query);
    setObjects(payload.objects);
    setSelected(
      payload.objects
        .filter((o) => typeof o.satlat === 'number' && typeof o.satlng === 'number')
        .map((o) => ({
          id: o.satid,
          entity_type: 'satellite',
          name: o.satname,
          latitude: o.satlat,
          longitude: o.satlng
        }))
    );
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

  const saveBackendUrl = async () => {
    setBackendUrl(backendUrlInput);
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
            <h1>N2YO Hybrid Proxy</h1>

            <div className="panel">
              <h2>Access</h2>
              <div className="row">
                <label>Backend URL</label>
                <input value={backendUrlInput} onChange={(e) => setBackendUrlInput(e.target.value)} />
              </div>
              <button className="secondary" onClick={saveBackendUrl}>Apply Backend URL</button>
              <div className="row">
                <label>N2YO API Key</label>
                <input value={n2yoKeyInput} onChange={(e) => setN2yoKeyInput(e.target.value)} />
              </div>
              <button className="secondary" onClick={saveN2yoKey}>Save N2YO Key</button>
              <div className="row">
                <label>Proxy API Key</label>
                <input value={proxyKeyInput} onChange={(e) => setProxyKeyInput(e.target.value)} />
              </div>
              <button onClick={saveProxyKey}>Apply Key</button>
            </div>

            <div className="panel">
              <h2>Status</h2>
              <p className="small">Sweeper: {status?.running ? 'running' : 'idle'}</p>
              <p className="small">Sweep stale: {status?.stale ? 'yes' : 'no'}</p>
              <p className="small">Objects: {status?.objectCount ?? 0}</p>
              <p className="small">TLEs: {status?.tleCount ?? 0}</p>
              <button onClick={() => runSweepNow().then(refreshAll)}>Run Full Sweep</button>
            </div>

            <div className="panel">
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
              <div className="items">
                {objects.slice(0, 80).map((o) => (
                  <div className="item" key={o.satid}>
                    <span>{o.satname}</span>
                    <span>#{o.satid}</span>
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
          </aside>

          <section className="globe-wrap">
            <GlobePanel />
          </section>
        </div>
      </SelectedProvider>
    </GeneralConfigProvider>
  );
};

export default App;
