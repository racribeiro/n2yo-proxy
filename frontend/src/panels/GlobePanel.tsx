/* eslint-disable */
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as satellite from 'satellite.js';
import { RefreshCcw } from 'lucide-react';
import { getSatellitesAbove, getSatelliteTles } from '../api/satellites';
import { useGeneralConfig } from '../contexts/GeneralConfigContext';
import { useSelected } from '../contexts/SelectedContext';

// ── Constants ─────────────────────────────────────────────────────────────────
const ISS_POLL_MS  = 5_000;
const SAT_POLL_MS  = 60_000;
const TLE_POLL_MS  = 120_000; // refresh TLE catalog every 2 min
const TLE_RECOMPUTE_MS = 15_000; // re-propagate local TLE positions every 15 s
const DEG         = Math.PI / 180;
const J2000       = Date.UTC(2000, 0, 1, 12); // ms

// ── Coordinate helpers ────────────────────────────────────────────────────────

function latLonToVec3(lat: number, lon: number, r = 1.0): THREE.Vector3 {
  const phi   = (90 - lat)  * DEG;
  const theta = (lon + 180) * DEG;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
     r * Math.cos(phi),
     r * Math.sin(phi) * Math.sin(theta),
  );
}

// Returns [subLatDeg, subLonDeg] for the Sun (±1° accuracy)
function sunSubPoint(date: Date): [number, number] {
  const D    = (date.getTime() - J2000) / 86_400_000;
  const g    = (357.529 + 0.98560028 * D) * DEG;
  const q    = (280.459 + 0.98564736 * D) % 360;
  const L    = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;
  const e    = (23.439 - 0.0000004 * D) * DEG;
  const ra   = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec  = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * D) % 24;
  const lon  = ((ra / DEG / 15 - gmst) * 15 + 180) % 360 - 180;
  return [dec / DEG, lon];
}

// Returns [subLatDeg, subLonDeg] for the Moon (±1° accuracy)
function moonSubPoint(date: Date): [number, number] {
  const D    = (date.getTime() - J2000) / 86_400_000;
  const L    = (218.316 + 13.176396 * D) % 360;
  const M    = (134.963 + 13.064993 * D) % 360;
  const F    = (93.272  + 13.229350 * D) % 360;
  const lam  = (L + 6.289 * Math.sin(M * DEG)) * DEG;
  const bet  = 5.128 * Math.sin(F * DEG) * DEG;
  const e    = 23.4393 * DEG;
  const ra   = Math.atan2(Math.cos(e) * Math.sin(lam) - Math.tan(bet) * Math.sin(e), Math.cos(lam));
  const dec  = Math.asin(Math.sin(bet) * Math.cos(e) + Math.cos(bet) * Math.sin(e) * Math.sin(lam));
  const gmst = (18.697374558 + 24.06570982441908 * D) % 24;
  const lon  = ((ra / DEG / 15 - gmst) * 15 + 180) % 360 - 180;
  return [dec / DEG, lon];
}

// Satellite altitude (km) → display sphere radius (log-scaled)
function altToRadius(altKm: number): number {
  return 1.0 + Math.log(1 + altKm / 400) * 0.42;
}

function fmtCoord(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
}

function ensurePointCapacity(
  geometry: THREE.BufferGeometry,
  positions: Float32Array,
  colors: Float32Array,
  count: number,
  defaultColor: [number, number, number],
): { positions: Float32Array; colors: Float32Array } {
  const requiredLength = count * 3;
  if (requiredLength <= positions.length && requiredLength <= colors.length) {
    return { positions, colors };
  }

  const currentCapacity = positions.length / 3;
  let nextCapacity = Math.max(currentCapacity, 256);
  while (nextCapacity < count) nextCapacity = Math.ceil(nextCapacity * 1.5);

  const nextPositions = new Float32Array(nextCapacity * 3);
  nextPositions.set(positions);

  const nextColors = new Float32Array(nextCapacity * 3);
  nextColors.set(colors);
  for (let i = colors.length; i < nextColors.length; i += 3) {
    nextColors[i] = defaultColor[0];
    nextColors[i + 1] = defaultColor[1];
    nextColors[i + 2] = defaultColor[2];
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(nextPositions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(nextColors, 3));

  return { positions: nextPositions, colors: nextColors };
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface IssInfo  { lat: number; lon: number; updated: Date; }
interface UserPos  { lat: number; lon: number; }
interface SatAbove { satid: number; satname: string; satlat: number; satlng: number; satalt: number; }
interface TleEntry { name: string; line1: string; line2: string; }

// ── Component ─────────────────────────────────────────────────────────────────
const GlobePanel: React.FC = () => {
  const mountRef = useRef<HTMLDivElement>(null);
  const { generalConfig } = useGeneralConfig();
  const { items: selectedItems } = useSelected();

  // Refs bridging Three.js setup ↔ polling effects (no re-render)
  const issPosRef    = useRef<THREE.Vector3 | null>(null);
  const issGrpRef    = useRef<THREE.Group   | null>(null);
  const userPosRef   = useRef<THREE.Vector3 | null>(null);
  const userDotRef   = useRef<THREE.Group   | null>(null);
  const userLatLon   = useRef<{ lat: number; lon: number }>({ lat: 0, lon: 0 });
  const satUpdateRef  = useRef<((sats: SatAbove[]) => void) | null>(null);
  const controlsRef   = useRef<OrbitControls | null>(null);
  const orbitRef      = useRef(true); // base orbit preference, read by onUp without stale closure
  const selectedMarkersRef  = useRef<Map<string, THREE.Group>>(new Map());
  const sceneRef            = useRef<THREE.Scene | null>(null);
  const tleDataRef          = useRef<TleEntry[]>([]);
  const tleUpdateRef        = useRef<((tles: TleEntry[], userLat: number, userLon: number) => void) | null>(null);

  // UI-only state (overlay re-renders)
  const [issInfo,  setIssInfo]  = useState<IssInfo | null>(null);
  const [issErr,   setIssErr]   = useState(false);
  const [userPos,  setUserPos]  = useState<UserPos | null>(null);
  const [satCount, setSatCount] = useState<number | null>(null);
  const [satErr,   setSatErr]   = useState(false);
  const [satUncfg, setSatUncfg] = useState(false);
  const [tleCount, setTleCount] = useState<number | null>(null);
  const [orbit,    setOrbit]    = useState(true);

  // ── Three.js scene setup ───────────────────────────────────────────────────
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const scene  = new THREE.Scene();
    sceneRef.current = scene;
    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.1, 1000);
    camera.position.z = 2.6;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);

    // OrbitControls
    const controls           = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping   = true;
    controls.dampingFactor   = 0.08;
    controls.enablePan       = false;
    controls.minDistance     = 1.3;
    controls.maxDistance     = 9;
    controls.autoRotate      = true;
    controls.autoRotateSpeed = 0.5;
    controlsRef.current      = controls;

    renderer.domElement.style.cursor = 'grab';
    const onDown = () => { controls.autoRotate = false; renderer.domElement.style.cursor = 'grabbing'; };
    const onUp   = () => { controls.autoRotate = orbitRef.current; renderer.domElement.style.cursor = 'grab'; };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup',   onUp);

    // Stars
    const starPos = new Float32Array(2000 * 3);
    for (let i = 0; i < starPos.length; i++) starPos[i] = (Math.random() - 0.5) * 400;
    const starGeom = new THREE.BufferGeometry();
    starGeom.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeom, new THREE.PointsMaterial({ color: 0xffffff, size: 0.15, sizeAttenuation: true })));

    // Earth
    const earthTex = new THREE.TextureLoader().load('/earth-blue-marble.jpg');
    scene.add(new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 64),
      new THREE.MeshPhongMaterial({ map: earthTex, specular: new THREE.Color(0x222222), shininess: 14 }),
    ));

    // Atmosphere glow
    scene.add(new THREE.Mesh(
      new THREE.SphereGeometry(1.04, 64, 64),
      new THREE.MeshPhongMaterial({ color: 0x4488ff, transparent: true, opacity: 0.07, side: THREE.FrontSide }),
    ));

    // Lights — ambient + directional sun (repositioned each frame)
    scene.add(new THREE.AmbientLight(0xffffff, 0.2));
    const sunLight = new THREE.DirectionalLight(0xfff5e0, 1.6);
    sunLight.position.set(5, 3, 5);
    scene.add(sunLight);

    // ── Sun sphere ──────────────────────────────────────────────────────────
    const sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xffee55 }),
    );
    // Glow halo around Sun
    const sunGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 24, 24),
      new THREE.MeshBasicMaterial({ color: 0xffdd00, transparent: true, opacity: 0.18 }),
    );
    sunMesh.add(sunGlow);
    scene.add(sunMesh);

    // Sub-solar surface dot (yellow, stays on Earth surface)
    const sunDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.015, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffee44 }),
    );
    scene.add(sunDot);

    // ── Moon sphere ─────────────────────────────────────────────────────────
    const moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 20, 20),
      new THREE.MeshBasicMaterial({ color: 0xccccbb }),
    );
    scene.add(moonMesh);

    // Sub-lunar surface dot (gray, stays on Earth surface)
    const moonDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.015, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x999988 }),
    );
    scene.add(moonDot);

    // ── Satellite points (BufferGeometry, vertex colors, single draw call) ──
    let satPositions = new Float32Array(0);
    let satColors    = new Float32Array(0);
    const satGeom      = new THREE.BufferGeometry();
    satGeom.setAttribute('position', new THREE.BufferAttribute(satPositions, 3));
    satGeom.setAttribute('color',    new THREE.BufferAttribute(satColors, 3));
    satGeom.setDrawRange(0, 0);
    const satPoints = new THREE.Points(
      satGeom,
      new THREE.PointsMaterial({ vertexColors: true, size: 2.5, sizeAttenuation: false }),
    );
    scene.add(satPoints);

    // ── Global (TLE-propagated) satellite points — non-visible dimmed gray ──
    let tlePositions = new Float32Array(0);
    let tleColors    = new Float32Array(0);
    const tleGeom      = new THREE.BufferGeometry();
    tleGeom.setAttribute('position', new THREE.BufferAttribute(tlePositions, 3));
    tleGeom.setAttribute('color',    new THREE.BufferAttribute(tleColors, 3));
    tleGeom.setDrawRange(0, 0);
    const tlePoints = new THREE.Points(
      tleGeom,
      new THREE.PointsMaterial({ vertexColors: true, size: 1.5, sizeAttenuation: false, opacity: 0.55, transparent: true }),
    );
    scene.add(tlePoints);

    tleUpdateRef.current = (tles: TleEntry[], userLat: number, userLon: number) => {
      ({ positions: tlePositions, colors: tleColors } = ensurePointCapacity(
        tleGeom,
        tlePositions,
        tleColors,
        tles.length,
        [0.35, 0.35, 0.35],
      ));

      const now = new Date();
      const obsGd = { latitude: userLat * DEG, longitude: userLon * DEG, height: 0 };
      let count = 0;
      for (let i = 0; i < tles.length; i++) {
        try {
          const satrec = satellite.twoline2satrec(tles[i].line1, tles[i].line2);
          const pv     = satellite.propagate(satrec, now);
          if (!pv || !pv.position || typeof pv.position === 'boolean') continue;
          const gmst   = satellite.gstime(now);
          const geo    = satellite.eciToGeodetic(pv.position as satellite.EciVec3<number>, gmst);
          const lat    = satellite.radiansToDegrees(geo.latitude);
          const lon    = satellite.radiansToDegrees(geo.longitude);
          const altKm  = geo.height;
          const r      = altToRadius(altKm);
          const v      = latLonToVec3(lat, lon, r);

          tlePositions[count * 3]     = v.x;
          tlePositions[count * 3 + 1] = v.y;
          tlePositions[count * 3 + 2] = v.z;

          // Elevation check: is this satellite above the observer's horizon?
          const lookAngles = satellite.ecfToLookAngles(obsGd, satellite.eciToEcf(pv.position as satellite.EciVec3<number>, gmst));
          const visible = lookAngles.elevation > 0;

          if (visible) {
            // Color by altitude tier (same as N2YO)
            if (altKm < 2000) {
              tleColors[count * 3] = 0.5; tleColors[count * 3 + 1] = 0.85; tleColors[count * 3 + 2] = 1.0;
            } else if (altKm < 20000) {
              tleColors[count * 3] = 1.0; tleColors[count * 3 + 1] = 0.9;  tleColors[count * 3 + 2] = 0.4;
            } else {
              tleColors[count * 3] = 1.0; tleColors[count * 3 + 1] = 1.0;  tleColors[count * 3 + 2] = 1.0;
            }
          } else {
            // Non-visible: dim gray
            tleColors[count * 3] = 0.3; tleColors[count * 3 + 1] = 0.3; tleColors[count * 3 + 2] = 0.3;
          }
          count++;
        } catch { /* skip malformed TLE */ }
      }
      (tleGeom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (tleGeom.attributes.color    as THREE.BufferAttribute).needsUpdate = true;
      tleGeom.setDrawRange(0, count);
    };

    // Expose update fn to satellite polling effect
    satUpdateRef.current = (sats: SatAbove[]) => {
      ({ positions: satPositions, colors: satColors } = ensurePointCapacity(
        satGeom,
        satPositions,
        satColors,
        sats.length,
        [1, 1, 1],
      ));

      const count = sats.length;
      for (let i = 0; i < count; i++) {
        const { satlat, satlng, satalt } = sats[i];
        const r   = altToRadius(satalt);
        const v   = latLonToVec3(satlat, satlng, r);
        satPositions[i * 3]     = v.x;
        satPositions[i * 3 + 1] = v.y;
        satPositions[i * 3 + 2] = v.z;
        // Color by altitude tier: LEO=cyan, MEO=yellow, GEO=white
        if (satalt < 2000) {
          satColors[i * 3] = 0.5; satColors[i * 3 + 1] = 0.85; satColors[i * 3 + 2] = 1.0;
        } else if (satalt < 20000) {
          satColors[i * 3] = 1.0; satColors[i * 3 + 1] = 0.9;  satColors[i * 3 + 2] = 0.4;
        } else {
          satColors[i * 3] = 1.0; satColors[i * 3 + 1] = 1.0;  satColors[i * 3 + 2] = 1.0;
        }
      }
      (satGeom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (satGeom.attributes.color    as THREE.BufferAttribute).needsUpdate = true;
      satGeom.setDrawRange(0, count);
    };

    // ── ISS marker ──────────────────────────────────────────────────────────
    const issGroup = new THREE.Group();
    issGroup.add(new THREE.Mesh(
      new THREE.SphereGeometry(0.018, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xff8c00 }),
    ));
    const issRingMat = new THREE.MeshBasicMaterial({ color: 0xff8c00, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
    const issRing = new THREE.Mesh(new THREE.RingGeometry(0.022, 0.034, 40), issRingMat);
    issGroup.add(issRing);
    issGroup.add(new THREE.PointLight(0xff8c00, 1.0, 0.25));
    issGroup.visible = false;
    scene.add(issGroup);
    issGrpRef.current = issGroup;

    // ── User location dot ────────────────────────────────────────────────────
    const userGroup = new THREE.Group();
    userGroup.add(new THREE.Mesh(
      new THREE.SphereGeometry(0.022, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0x4488ff }),
    ));
    const userRingMat = new THREE.MeshBasicMaterial({ color: 0x4499ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
    const userRing = new THREE.Mesh(new THREE.RingGeometry(0.026, 0.038, 40), userRingMat);
    userGroup.add(userRing);
    userGroup.add(new THREE.PointLight(0x4488ff, 0.8, 0.3));
    userGroup.visible = false;
    scene.add(userGroup);
    userDotRef.current = userGroup;

    // ── Animation loop ───────────────────────────────────────────────────────
    let rafId: number;
    let issT  = 0; // ISS pulse phase
    let userT = 0; // user dot pulse phase

    const animate = () => {
      rafId = requestAnimationFrame(animate);
      controls.update();

      // Sun & Moon — recompute position each frame (cheap trig, moves slowly)
      const now = new Date();
      const [sLat, sLon] = sunSubPoint(now);
      const sunPos = latLonToVec3(sLat, sLon, 7.6);
      sunMesh.position.copy(sunPos);
      sunLight.position.copy(sunPos);   // directional light tracks Sun
      sunDot.position.copy(latLonToVec3(sLat, sLon, 1.012));

      const [mLat, mLon] = moonSubPoint(now);
      moonMesh.position.copy(latLonToVec3(mLat, mLon, 4.3));
      moonDot.position.copy(latLonToVec3(mLat, mLon, 1.012));

      // ISS
      if (issPosRef.current && issGroup.visible) {
        issGroup.position.copy(issPosRef.current);
        issRing.lookAt(camera.position);
        issT = (issT + 0.018) % 1;
        issRing.scale.setScalar(1 + issT * 2.5);
        issRingMat.opacity = 0.7 * (1 - issT);
      }

      // User dot
      if (userPosRef.current && userGroup.visible) {
        userGroup.position.copy(userPosRef.current);
        userRing.lookAt(camera.position);
        userT = (userT + 0.014) % 1;
        userRing.scale.setScalar(1 + userT * 2.5);
        userRingMat.opacity = 0.6 * (1 - userT);
      }

      renderer.render(scene, camera);
    };
    animate();

    // Resize
    const ro = new ResizeObserver(() => {
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
    });
    ro.observe(el);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup',   onUp);
      controls.dispose();
      renderer.dispose();
      earthTex.dispose();
      issGrpRef.current    = null;
      userDotRef.current   = null;
      satUpdateRef.current = null;
      tleUpdateRef.current = null;
      controlsRef.current  = null;
      sceneRef.current     = null;
      selectedMarkersRef.current.clear();
      el.removeChild(renderer.domElement);
    };
  }, []);

  // ── User location from installation config ────────────────────────────────
  useEffect(() => {
    const lat = (generalConfig as any).latitude  ?? 0;
    const lon = (generalConfig as any).longitude ?? 0;
    if (lat === 0 && lon === 0) return;
    userLatLon.current = { lat, lon };
    setUserPos({ lat, lon });
    const pos = latLonToVec3(lat, lon, 1.015);
    userPosRef.current = pos;
    if (userDotRef.current) {
      userDotRef.current.position.copy(pos);
      userDotRef.current.visible = true;
    }
  }, [(generalConfig as any).latitude, (generalConfig as any).longitude]);

  // ── ISS polling ───────────────────────────────────────────────────────────
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch('http://api.open-notify.org/iss-now.json');
        const d   = await res.json();
        const lat = parseFloat(d.iss_position.latitude);
        const lon = parseFloat(d.iss_position.longitude);
        issPosRef.current = latLonToVec3(lat, lon, 1.055);
        if (issGrpRef.current) issGrpRef.current.visible = true;
        setIssInfo({ lat, lon, updated: new Date() });
        setIssErr(false);
      } catch {
        setIssErr(true);
      }
      timer = setTimeout(poll, ISS_POLL_MS);
    };
    poll();
    return () => clearTimeout(timer);
  }, []);

  // ── Satellite polling ─────────────────────────────────────────────────────
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const { lat, lon } = userLatLon.current;
      try {
        const data = await getSatellitesAbove(lat, lon);
        if (data.unconfigured) { setSatUncfg(true); return; }
        const above: SatAbove[] = data.above ?? [];
        satUpdateRef.current?.(above);
        setSatCount(above.length);
        setSatErr(false);
      } catch {
        setSatErr(true);
      }
      timer = setTimeout(poll, SAT_POLL_MS);
    };
    poll();
    return () => clearTimeout(timer);
  }, [userPos]); // re-run once user location becomes available

  // ── Global TLE satellite polling ──────────────────────────────────────────
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let active = true;

    const update = () => {
      const tles = tleDataRef.current;
      const { lat, lon } = userLatLon.current;
      if (tles.length > 0 && tleUpdateRef.current) {
        tleUpdateRef.current(tles, lat, lon);
      }
    };

    const poll = async () => {
      try {
        const tles = await getSatelliteTles();
        if (active) {
          tleDataRef.current = tles;
          setTleCount(tles.length);
          update();
        }
      } catch { /* silently ignore */ }
      if (active) timer = setTimeout(poll, TLE_POLL_MS);
    };

    poll();
    return () => { active = false; clearTimeout(timer); };
  }, [userPos]); // re-run once user position is known

  // ── Local TLE propagation refresh ────────────────────────────────────────
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let active = true;

    const tick = () => {
      const tles = tleDataRef.current;
      const { lat, lon } = userLatLon.current;
      if (tles.length > 0 && tleUpdateRef.current) {
        tleUpdateRef.current(tles, lat, lon);
      }
      if (active) timer = setTimeout(tick, TLE_RECOMPUTE_MS);
    };

    tick();
    return () => { active = false; clearTimeout(timer); };
  }, [userPos]);

  // ── Selected items globe markers ──────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const existing = selectedMarkersRef.current;
    const geoItems = selectedItems.filter(i => i.latitude != null && i.longitude != null);
    const nextKeys  = new Set(geoItems.map(i => `${i.entity_type}:${i.id}`));

    // Remove markers for deselected items
    for (const [k, grp] of existing.entries()) {
      if (!nextKeys.has(k)) {
        scene.remove(grp);
        existing.delete(k);
      }
    }

    // Add markers for newly selected items
    for (const item of geoItems) {
      const k = `${item.entity_type}:${item.id}`;
      if (existing.has(k)) continue;

      const grp = new THREE.Group();
      grp.add(new THREE.Mesh(
        new THREE.SphereGeometry(0.018, 14, 14),
        new THREE.MeshBasicMaterial({ color: 0x00e87a }),
      ));
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x00e87a, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.022, 0.034, 36), ringMat);
      grp.add(ring);
      grp.add(new THREE.PointLight(0x00e87a, 0.8, 0.28));
      grp.position.copy(latLonToVec3(item.latitude!, item.longitude!, 1.015));
      scene.add(grp);
      existing.set(k, grp);
    }
  }, [selectedItems]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="relative w-full h-full bg-[#05080f] select-none">
      <div ref={mountRef} className="w-full h-full" />

      {/* Live indicator — top right */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5 pointer-events-none">
        <span className="text-[10px] text-slate-500 uppercase tracking-widest">Live</span>
        <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.6)]" />
      </div>

      {/* Legend — top left */}
      <div className="absolute top-3 left-3 pointer-events-none space-y-1">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-yellow-300 shadow-[0_0_6px_#fde047]" />
          <span className="text-[10px] text-slate-400">Sun</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-[#ccccbb]" />
          <span className="text-[10px] text-slate-400">Moon</span>
        </div>
        {(satCount !== null && satCount > 0) || (tleCount !== null && tleCount > 0) ? (
          <>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-cyan-400" />
              <span className="text-[10px] text-slate-400">LEO</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-yellow-400" />
              <span className="text-[10px] text-slate-400">MEO</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-white" />
              <span className="text-[10px] text-slate-400">GEO</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-slate-600" />
              <span className="text-[10px] text-slate-400">Not visible</span>
            </div>
          </>
        ) : null}
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-orange-400" />
          <span className="text-[10px] text-slate-400">ISS</span>
        </div>
        {userPos && (
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-blue-400" />
            <span className="text-[10px] text-slate-400">You</span>
          </div>
        )}
        {selectedItems.some(i => i.latitude != null) && (
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-[10px] text-slate-400">Selected</span>
          </div>
        )}
      </div>

      {/* Status HUD — bottom left */}
      <div className="absolute bottom-3 left-3 pointer-events-none space-y-1.5">
        {/* ISS */}
        {issInfo ? (
          <div>
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-pulse" />
              <span className="text-[10px] text-orange-400 font-semibold uppercase tracking-widest">ISS</span>
            </div>
            <p className="text-[11px] text-slate-300 font-mono tabular-nums">{fmtCoord(issInfo.lat, issInfo.lon)}</p>
            <p className="text-[10px] text-slate-600">{issInfo.updated.toLocaleTimeString('en-GB', { hour12: false })}</p>
          </div>
        ) : issErr ? (
          <p className="text-[10px] text-red-600">ISS unavailable</p>
        ) : (
          <p className="text-[10px] text-slate-700">Acquiring ISS…</p>
        )}

        {/* Satellites */}
        {tleCount !== null && (
          <p className="text-[10px] text-slate-500">{tleCount} objects global</p>
        )}
        {!satUncfg && !satErr && satCount !== null && (
          <p className="text-[10px] text-slate-500">{satCount} visible</p>
        )}
        {satUncfg && (
          <p className="text-[10px] text-amber-600">Set N2YO key for visible highlight</p>
        )}

        {/* User location */}
        {userPos && (
          <p className="text-[10px] text-blue-500 font-mono">{fmtCoord(userPos.lat, userPos.lon)}</p>
        )}
      </div>

      {/* Orbit toggle + interaction hint — bottom right */}
      <div className="absolute bottom-3 right-3 flex items-center gap-2">
        <p className="text-[10px] text-slate-700 pointer-events-none">Drag · Scroll to zoom</p>
        <button
          onClick={() => {
            const next = !orbitRef.current;
            orbitRef.current = next;
            setOrbit(next);
            if (controlsRef.current) controlsRef.current.autoRotate = next;
          }}
          title={orbit ? 'Pause orbit' : 'Resume orbit'}
          className={`p-1 rounded transition-colors ${
            orbit
              ? 'text-blue-400 hover:text-blue-300'
              : 'text-slate-600 hover:text-slate-400'
          }`}
        >
          <RefreshCcw size={13} className={orbit ? 'animate-spin [animation-duration:4s]' : ''} />
        </button>
      </div>
    </div>
  );
};

export default GlobePanel;
