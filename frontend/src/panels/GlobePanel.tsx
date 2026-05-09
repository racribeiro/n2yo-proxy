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
const SAT_POLL_MS  = 60_000;
const TLE_POLL_MS  = 120_000; // refresh TLE catalog every 2 min
const TLE_RECOMPUTE_MS = 15_000; // re-propagate local TLE positions every 15 s
const DEG         = Math.PI / 180;
const J2000       = Date.UTC(2000, 0, 1, 12); // ms
const EARTH_RADIUS_KM = 6371;
const MOON_RADIUS_EARTH = 1737.4 / EARTH_RADIUS_KM;
const SUN_RADIUS_EARTH = 695700 / EARTH_RADIUS_KM;
const MOON_DISTANCE_EARTH = 384400 / EARTH_RADIUS_KM;
const SUN_DISTANCE_EARTH = 149597870 / EARTH_RADIUS_KM;

type BrightStar = { name: string; raHours: number; decDeg: number; mag: number };
const BRIGHT_STARS: BrightStar[] = [
  { name: 'Sirius', raHours: 6.7525, decDeg: -16.7161, mag: -1.46 },
  { name: 'Canopus', raHours: 6.3992, decDeg: -52.6957, mag: -0.74 },
  { name: 'Arcturus', raHours: 14.261, decDeg: 19.1825, mag: -0.05 },
  { name: 'Vega', raHours: 18.6156, decDeg: 38.7837, mag: 0.03 },
  { name: 'Capella', raHours: 5.2782, decDeg: 45.998, mag: 0.08 },
  { name: 'Rigel', raHours: 5.2423, decDeg: -8.2017, mag: 0.13 },
  { name: 'Procyon', raHours: 7.655, decDeg: 5.225, mag: 0.34 },
  { name: 'Achernar', raHours: 1.6286, decDeg: -57.2368, mag: 0.46 },
  { name: 'Betelgeuse', raHours: 5.9195, decDeg: 7.4071, mag: 0.5 },
  { name: 'Hadar', raHours: 14.0637, decDeg: -60.373, mag: 0.61 },
  { name: 'Altair', raHours: 19.8464, decDeg: 8.8683, mag: 0.77 },
  { name: 'Acrux', raHours: 12.4433, decDeg: -63.0991, mag: 0.76 },
  { name: 'Aldebaran', raHours: 4.5987, decDeg: 16.5093, mag: 0.85 },
  { name: 'Spica', raHours: 13.4199, decDeg: -11.1614, mag: 0.97 },
  { name: 'Antares', raHours: 16.4901, decDeg: -26.432, mag: 1.06 },
  { name: 'Pollux', raHours: 7.7553, decDeg: 28.0262, mag: 1.14 },
  { name: 'Fomalhaut', raHours: 22.9608, decDeg: -29.6222, mag: 1.16 },
  { name: 'Deneb', raHours: 20.6905, decDeg: 45.2803, mag: 1.25 },
  { name: 'Regulus', raHours: 10.1395, decDeg: 11.9672, mag: 1.35 },
  { name: 'Adhara', raHours: 6.9771, decDeg: -28.9721, mag: 1.5 },
];

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

function altToRadiusReal(altKm: number): number {
  return 1.0 + altKm / EARTH_RADIUS_KM;
}

function fmtCoord(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
}

function raDecToVec3(raHours: number, decDeg: number, radius: number): THREE.Vector3 {
  const ra = (raHours / 24) * Math.PI * 2;
  const dec = decDeg * DEG;
  const x = radius * Math.cos(dec) * Math.cos(ra);
  const y = radius * Math.sin(dec);
  const z = radius * Math.cos(dec) * Math.sin(ra);
  return new THREE.Vector3(x, y, z);
}

function ensurePointCapacity(
  geometry: THREE.BufferGeometry,
  positions: Float32Array<ArrayBufferLike>,
  colors: Float32Array<ArrayBufferLike>,
  count: number,
  defaultColor: [number, number, number],
): { positions: Float32Array<ArrayBufferLike>; colors: Float32Array<ArrayBufferLike> } {
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

function makeEarthTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const fallback = new THREE.CanvasTexture(canvas);
    fallback.needsUpdate = true;
    return fallback;
  }

  const ocean = ctx.createLinearGradient(0, 0, 0, canvas.height);
  ocean.addColorStop(0, '#0b2f56');
  ocean.addColorStop(0.5, '#0f4b7b');
  ocean.addColorStop(1, '#0a2746');
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.globalAlpha = 0.85;
  ctx.fillStyle = '#4f7f3f';
  const blobs = [
    [280, 240, 260, 150],
    [520, 330, 180, 110],
    [780, 250, 240, 130],
    [1060, 290, 320, 160],
    [1380, 230, 260, 150],
    [1600, 350, 210, 120],
    [1820, 250, 170, 110],
    [1250, 520, 220, 170],
    [1650, 590, 290, 190],
    [420, 620, 170, 130],
    [840, 640, 240, 140]
  ] as const;
  for (const [x, y, w, h] of blobs) {
    ctx.beginPath();
    ctx.ellipse(x, y, w, h, Math.PI / 10, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = ((90 - lat) / 180) * canvas.height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
  for (let lon = -150; lon <= 150; lon += 30) {
    const x = ((lon + 180) / 360) * canvas.width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface IssInfo  { lat: number; lon: number; updated: Date; }
interface UserPos  { lat: number; lon: number; }
interface SatAbove { satid: number; satname: string; satlat: number; satlng: number; satalt: number; }
interface TleEntry { satid: number; name: string; line1: string; line2: string; }
interface PickedSatellite {
  satid: number;
  satname: string;
  latitude: number;
  longitude: number;
  altitudeKm: number;
  source: 'above' | 'tle';
}

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
  const sunMeshRef          = useRef<THREE.Mesh | null>(null);
  const sunDotRef           = useRef<THREE.Mesh | null>(null);
  const moonMeshRef         = useRef<THREE.Mesh | null>(null);
  const moonDotRef          = useRef<THREE.Mesh | null>(null);
  const satPointsRef        = useRef<THREE.Points | null>(null);
  const tlePointsRef        = useRef<THREE.Points | null>(null);
  const tleDataRef          = useRef<TleEntry[]>([]);
  const tleBySatidRef       = useRef<Map<number, TleEntry>>(new Map());
  const tleUpdateRef        = useRef<((tles: TleEntry[], userLat: number, userLon: number) => void) | null>(null);
  const visibleAboveRef     = useRef<SatAbove[]>([]);
  const visibleTlesRef      = useRef<TleEntry[]>([]);
  const renderedAboveRef    = useRef<PickedSatellite[]>([]);
  const renderedTleRef      = useRef<PickedSatellite[]>([]);
  const orbitLineRef        = useRef<THREE.Line | null>(null);
  const drawOrbitTrackRef   = useRef<((satid: number) => void) | null>(null);
  const layerStateRef       = useRef({
    sun: true,
    moon: true,
    leo: true,
    meo: true,
    geo: true,
    notVisible: true,
    iss: true,
    user: true,
    selected: true,
  });
  const scaleModeRef = useRef<'log' | 'real'>('log');

  // UI-only state (overlay re-renders)
  const [issInfo,  setIssInfo]  = useState<IssInfo | null>(null);
  const [issErr,   setIssErr]   = useState(false);
  const [userPos,  setUserPos]  = useState<UserPos | null>(null);
  const [satCount, setSatCount] = useState<number | null>(null);
  const [satErr,   setSatErr]   = useState(false);
  const [satUncfg, setSatUncfg] = useState(false);
  const [tleCount, setTleCount] = useState<number | null>(null);
  const [orbit,    setOrbit]    = useState(true);
  const [layers, setLayers] = useState(layerStateRef.current);
  const [pickedSatellite, setPickedSatellite] = useState<PickedSatellite | null>(null);
  const [scaleMode, setScaleMode] = useState<'log' | 'real'>('log');

  // ── Three.js scene setup ───────────────────────────────────────────────────
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const scene  = new THREE.Scene();
    sceneRef.current = scene;
    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.1, 100000);
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
    controls.maxDistance     = 10000;
    controls.autoRotate      = true;
    controls.autoRotateSpeed = 0.5;
    controlsRef.current      = controls;

    renderer.domElement.style.cursor = 'grab';
    const onDown = () => { controls.autoRotate = false; renderer.domElement.style.cursor = 'grabbing'; };
    const onUp   = () => { controls.autoRotate = orbitRef.current; renderer.domElement.style.cursor = 'grab'; };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup',   onUp);

    // Stars
    const starRadius = 90000;
    const starPos = new Float32Array(BRIGHT_STARS.length * 3);
    for (let i = 0; i < BRIGHT_STARS.length; i++) {
      const v = raDecToVec3(BRIGHT_STARS[i].raHours, BRIGHT_STARS[i].decDeg, starRadius);
      starPos[i * 3] = v.x;
      starPos[i * 3 + 1] = v.y;
      starPos[i * 3 + 2] = v.z;
    }
    const starGeom = new THREE.BufferGeometry();
    starGeom.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeom, new THREE.PointsMaterial({ color: 0xffffff, size: 240, sizeAttenuation: true })));

    // Earth + Moon textures (real texture maps)
    const textureLoader = new THREE.TextureLoader();
    const earthTex = textureLoader.load('https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg');
    earthTex.colorSpace = THREE.SRGBColorSpace;
    const moonTex = textureLoader.load('https://threejs.org/examples/textures/planets/moon_1024.jpg');
    moonTex.colorSpace = THREE.SRGBColorSpace;
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
    sunMeshRef.current = sunMesh;

    // Sub-solar surface dot (yellow, stays on Earth surface)
    const sunDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.015, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffee44 }),
    );
    scene.add(sunDot);
    sunDotRef.current = sunDot;

    // ── Moon sphere ─────────────────────────────────────────────────────────
    const moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 20, 20),
      new THREE.MeshPhongMaterial({ map: moonTex }),
    );
    scene.add(moonMesh);
    moonMeshRef.current = moonMesh;

    // Sub-lunar surface dot (gray, stays on Earth surface)
    const moonDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.015, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x999988 }),
    );
    scene.add(moonDot);
    moonDotRef.current = moonDot;

    // ── Satellite points (BufferGeometry, vertex colors, single draw call) ──
    let satPositions: Float32Array<ArrayBufferLike> = new Float32Array(0);
    let satColors: Float32Array<ArrayBufferLike> = new Float32Array(0);
    const satGeom      = new THREE.BufferGeometry();
    satGeom.setAttribute('position', new THREE.BufferAttribute(satPositions, 3));
    satGeom.setAttribute('color',    new THREE.BufferAttribute(satColors, 3));
    satGeom.setDrawRange(0, 0);
    const satPoints = new THREE.Points(
      satGeom,
      new THREE.PointsMaterial({ vertexColors: true, size: 2.5, sizeAttenuation: false }),
    );
    scene.add(satPoints);
    satPointsRef.current = satPoints;

    // ── Global (TLE-propagated) satellite points — non-visible dimmed gray ──
    let tlePositions: Float32Array<ArrayBufferLike> = new Float32Array(0);
    let tleColors: Float32Array<ArrayBufferLike> = new Float32Array(0);
    const tleGeom      = new THREE.BufferGeometry();
    tleGeom.setAttribute('position', new THREE.BufferAttribute(tlePositions, 3));
    tleGeom.setAttribute('color',    new THREE.BufferAttribute(tleColors, 3));
    tleGeom.setDrawRange(0, 0);
    const tlePoints = new THREE.Points(
      tleGeom,
      new THREE.PointsMaterial({ vertexColors: true, size: 1.5, sizeAttenuation: false, opacity: 0.55, transparent: true }),
    );
    scene.add(tlePoints);
    tlePointsRef.current = tlePoints;

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
      renderedTleRef.current = [];
      for (let i = 0; i < tles.length; i++) {
        try {
          const satrec = satellite.twoline2satrec(tles[i].line1, tles[i].line2);
          const pv     = satellite.propagate(satrec, now);
          if (!pv || !pv.position || typeof pv.position === 'boolean') continue;
          const gmst   = satellite.gstime(now);
          const geo    = satellite.eciToGeodetic(pv.position as satellite.EciVec3<number>, gmst);
          const lat    = satellite.degreesLat(geo.latitude);
          const lon    = satellite.degreesLong(geo.longitude);
          const altKm  = geo.height;
          const r      = scaleModeRef.current === 'real' ? altToRadiusReal(altKm) : altToRadius(altKm);
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
              if (!layerStateRef.current.leo) continue;
              tleColors[count * 3] = 0.5; tleColors[count * 3 + 1] = 0.85; tleColors[count * 3 + 2] = 1.0;
            } else if (altKm < 20000) {
              if (!layerStateRef.current.meo) continue;
              tleColors[count * 3] = 1.0; tleColors[count * 3 + 1] = 0.9;  tleColors[count * 3 + 2] = 0.4;
            } else {
              if (!layerStateRef.current.geo) continue;
              tleColors[count * 3] = 1.0; tleColors[count * 3 + 1] = 1.0;  tleColors[count * 3 + 2] = 1.0;
            }
          } else {
            if (!layerStateRef.current.notVisible) continue;
            // Non-visible: dim gray
            tleColors[count * 3] = 0.3; tleColors[count * 3 + 1] = 0.3; tleColors[count * 3 + 2] = 0.3;
          }
          renderedTleRef.current.push({
            satid: tles[i].satid,
            satname: tles[i].name,
            latitude: lat,
            longitude: lon,
            altitudeKm: altKm,
            source: 'tle'
          });
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

      let count = 0;
      renderedAboveRef.current = [];
      for (let i = 0; i < sats.length; i++) {
        const { satlat, satlng, satalt } = sats[i];
        let render = true;
        // Color by altitude tier: LEO=cyan, MEO=yellow, GEO=white
        if (satalt < 2000) {
          render = layerStateRef.current.leo;
        } else if (satalt < 20000) {
          render = layerStateRef.current.meo;
        } else {
          render = layerStateRef.current.geo;
        }
        if (!render) continue;
        const r = scaleModeRef.current === 'real' ? altToRadiusReal(satalt) : altToRadius(satalt);
        const v = latLonToVec3(satlat, satlng, r);
        satPositions[count * 3] = v.x;
        satPositions[count * 3 + 1] = v.y;
        satPositions[count * 3 + 2] = v.z;
        if (satalt < 2000) {
          satColors[count * 3] = 0.5; satColors[count * 3 + 1] = 0.85; satColors[count * 3 + 2] = 1.0;
        } else if (satalt < 20000) {
          satColors[count * 3] = 1.0; satColors[count * 3 + 1] = 0.9; satColors[count * 3 + 2] = 0.4;
        } else {
          satColors[count * 3] = 1.0; satColors[count * 3 + 1] = 1.0; satColors[count * 3 + 2] = 1.0;
        }
        renderedAboveRef.current.push({
          satid: sats[i].satid,
          satname: sats[i].satname,
          latitude: satlat,
          longitude: satlng,
          altitudeKm: satalt,
          source: 'above'
        });
        count++;
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
      const sunDistance = scaleModeRef.current === 'real' ? SUN_DISTANCE_EARTH : 7.6;
      const sunPos = latLonToVec3(sLat, sLon, sunDistance);
      sunMesh.position.copy(sunPos);
      sunLight.position.copy(sunPos);   // directional light tracks Sun
      sunMesh.scale.setScalar(scaleModeRef.current === 'real' ? SUN_RADIUS_EARTH / 0.14 : 1);
      sunDot.position.copy(latLonToVec3(sLat, sLon, 1.012));

      const [mLat, mLon] = moonSubPoint(now);
      const moonDistance = scaleModeRef.current === 'real' ? MOON_DISTANCE_EARTH : 4.3;
      moonMesh.position.copy(latLonToVec3(mLat, mLon, moonDistance));
      moonMesh.scale.setScalar(scaleModeRef.current === 'real' ? MOON_RADIUS_EARTH / 0.07 : 1);
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

    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 0.04 };
    const pointer = new THREE.Vector2();

    const drawOrbitTrack = (satid: number) => {
      const tle = tleBySatidRef.current.get(satid);
      if (!tle) return;
      try {
        const satrec = satellite.twoline2satrec(tle.line1, tle.line2);
        const coords: number[] = [];
        const center = Date.now();
        for (let minute = -120; minute <= 120; minute += 2) {
          const when = new Date(center + minute * 60_000);
          const pv = satellite.propagate(satrec, when);
          if (!pv || !pv.position || typeof pv.position === 'boolean') continue;
          const gmst = satellite.gstime(when);
          const geo = satellite.eciToGeodetic(pv.position as satellite.EciVec3<number>, gmst);
          const lat = satellite.degreesLat(geo.latitude);
          const lon = satellite.degreesLong(geo.longitude);
          const r = scaleModeRef.current === 'real' ? altToRadiusReal(geo.height) : altToRadius(geo.height);
          const point = latLonToVec3(lat, lon, r);
          coords.push(point.x, point.y, point.z);
        }
        if (orbitLineRef.current) {
          scene.remove(orbitLineRef.current);
          orbitLineRef.current.geometry.dispose();
          (orbitLineRef.current.material as THREE.Material).dispose();
          orbitLineRef.current = null;
        }
        if (coords.length >= 6) {
          const orbitGeom = new THREE.BufferGeometry();
          orbitGeom.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
          const orbitMat = new THREE.LineBasicMaterial({ color: 0xff4d6d, transparent: true, opacity: 0.9 });
          const orbitLine = new THREE.Line(orbitGeom, orbitMat);
          scene.add(orbitLine);
          orbitLineRef.current = orbitLine;
        }
      } catch {
        // Ignore malformed TLEs.
      }
    };
    drawOrbitTrackRef.current = drawOrbitTrack;

    const onClick = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const aboveHit = raycaster.intersectObject(satPoints, false)[0];
      if (aboveHit && typeof aboveHit.index === 'number') {
        const item = renderedAboveRef.current[aboveHit.index];
        if (item) {
          setPickedSatellite(item);
          drawOrbitTrack(item.satid);
          return;
        }
      }

      const tleHit = raycaster.intersectObject(tlePoints, false)[0];
      if (tleHit && typeof tleHit.index === 'number') {
        const item = renderedTleRef.current[tleHit.index];
        if (item) {
          setPickedSatellite(item);
          drawOrbitTrack(item.satid);
          return;
        }
      }
    };
    renderer.domElement.addEventListener('click', onClick);

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
      renderer.domElement.removeEventListener('click', onClick);
      controls.dispose();
      renderer.dispose();
      earthTex.dispose();
      moonTex.dispose();
      if (orbitLineRef.current) {
        scene.remove(orbitLineRef.current);
        orbitLineRef.current.geometry.dispose();
        (orbitLineRef.current.material as THREE.Material).dispose();
        orbitLineRef.current = null;
      }
      drawOrbitTrackRef.current = null;
      issGrpRef.current    = null;
      userDotRef.current   = null;
      satUpdateRef.current = null;
      tleUpdateRef.current = null;
      controlsRef.current  = null;
      sceneRef.current     = null;
      sunMeshRef.current   = null;
      sunDotRef.current    = null;
      moonMeshRef.current  = null;
      moonDotRef.current   = null;
      satPointsRef.current = null;
      tlePointsRef.current = null;
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
      userDotRef.current.visible = layerStateRef.current.user;
    }
  }, [(generalConfig as any).latitude, (generalConfig as any).longitude]);

  // ISS external polling removed to avoid cross-origin requests.

  // ── Satellite polling ─────────────────────────────────────────────────────
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const { lat, lon } = userLatLon.current;
      try {
        const data = await getSatellitesAbove(lat, lon);
        if (data.unconfigured) { setSatUncfg(true); return; }
        const above: SatAbove[] = data.above ?? [];
        visibleAboveRef.current = above;
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
          tleBySatidRef.current = new Map(tles.map((t) => [t.satid, t]));
          visibleTlesRef.current = tles;
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
      grp.visible = layerStateRef.current.selected;
      scene.add(grp);
      existing.set(k, grp);
    }
  }, [selectedItems]);

  useEffect(() => {
    layerStateRef.current = layers;
    if (issGrpRef.current) issGrpRef.current.visible = layers.iss && Boolean(issPosRef.current);
    if (userDotRef.current) userDotRef.current.visible = layers.user && Boolean(userPosRef.current);
    if (sunMeshRef.current) sunMeshRef.current.visible = layers.sun;
    if (sunDotRef.current) sunDotRef.current.visible = layers.sun;
    if (moonMeshRef.current) moonMeshRef.current.visible = layers.moon;
    if (moonDotRef.current) moonDotRef.current.visible = layers.moon;
    for (const grp of selectedMarkersRef.current.values()) grp.visible = layers.selected;
    if (visibleAboveRef.current.length > 0) satUpdateRef.current?.(visibleAboveRef.current);
    if (visibleTlesRef.current.length > 0) {
      const { lat, lon } = userLatLon.current;
      tleUpdateRef.current?.(visibleTlesRef.current, lat, lon);
    }
  }, [layers]);

  useEffect(() => {
    scaleModeRef.current = scaleMode;
    if (visibleAboveRef.current.length > 0) satUpdateRef.current?.(visibleAboveRef.current);
    if (visibleTlesRef.current.length > 0) {
      const { lat, lon } = userLatLon.current;
      tleUpdateRef.current?.(visibleTlesRef.current, lat, lon);
    }
    if (pickedSatellite) {
      drawOrbitTrackRef.current?.(pickedSatellite.satid);
      setPickedSatellite({ ...pickedSatellite });
    }
  }, [scaleMode]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: '100%', background: '#05080f', userSelect: 'none' }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      {/* Live indicator — top right */}
      <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', alignItems: 'center', gap: 6, pointerEvents: 'none' }}>
        <span className="text-[10px] text-slate-500 uppercase tracking-widest">Live</span>
        <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.6)]" />
      </div>

      {/* Legend — top left */}
      <div style={{ position: 'absolute', top: 12, left: 12, pointerEvents: 'auto' }}>
        <span onClick={() => setLayers((s) => ({ ...s, sun: !s.sun }))} className="flex items-center gap-1.5 cursor-pointer select-none">
          <div className="w-1.5 h-1.5 rounded-full bg-yellow-300 shadow-[0_0_6px_#fde047]" style={{ opacity: layers.sun ? 1 : 0.25 }} />
          <span className="text-[10px] text-slate-400 tracking-wide">SUN</span>
        </span>
        <span onClick={() => setLayers((s) => ({ ...s, moon: !s.moon }))} className="flex items-center gap-1.5 cursor-pointer select-none">
          <div className="w-1.5 h-1.5 rounded-full bg-[#ccccbb]" style={{ opacity: layers.moon ? 1 : 0.25 }} />
          <span className="text-[10px] text-slate-400 tracking-wide">MOON</span>
        </span>
        {(satCount !== null && satCount > 0) || (tleCount !== null && tleCount > 0) ? (
          <>
            <span onClick={() => setLayers((s) => ({ ...s, leo: !s.leo }))} className="flex items-center gap-1.5 cursor-pointer select-none">
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-400" style={{ opacity: layers.leo ? 1 : 0.25 }} />
              <span className="text-[10px] text-slate-400">LEO</span>
            </span>
            <span onClick={() => setLayers((s) => ({ ...s, meo: !s.meo }))} className="flex items-center gap-1.5 cursor-pointer select-none">
              <div className="w-1.5 h-1.5 rounded-full bg-yellow-400" style={{ opacity: layers.meo ? 1 : 0.25 }} />
              <span className="text-[10px] text-slate-400">MEO</span>
            </span>
            <span onClick={() => setLayers((s) => ({ ...s, geo: !s.geo }))} className="flex items-center gap-1.5 cursor-pointer select-none">
              <div className="w-1.5 h-1.5 rounded-full bg-white" style={{ opacity: layers.geo ? 1 : 0.25 }} />
              <span className="text-[10px] text-slate-400">GEO</span>
            </span>
            <span onClick={() => setLayers((s) => ({ ...s, notVisible: !s.notVisible }))} className="flex items-center gap-1.5 cursor-pointer select-none">
              <div className="w-1.5 h-1.5 rounded-full bg-slate-600" style={{ opacity: layers.notVisible ? 1 : 0.25 }} />
              <span className="text-[10px] text-slate-400 tracking-wide">NOT VISIBLE</span>
            </span>
          </>
        ) : null}
        <span onClick={() => setLayers((s) => ({ ...s, iss: !s.iss }))} className="flex items-center gap-1.5 cursor-pointer select-none">
          <div className="w-1.5 h-1.5 rounded-full bg-orange-400" style={{ opacity: layers.iss ? 1 : 0.25 }} />
          <span className="text-[10px] text-slate-400">ISS</span>
        </span>
        {userPos && (
          <span onClick={() => setLayers((s) => ({ ...s, user: !s.user }))} className="flex items-center gap-1.5 cursor-pointer select-none">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400" style={{ opacity: layers.user ? 1 : 0.25 }} />
            <span className="text-[10px] text-slate-400 tracking-wide">YOU</span>
          </span>
        )}
        {selectedItems.some(i => i.latitude != null) && (
          <span onClick={() => setLayers((s) => ({ ...s, selected: !s.selected }))} className="flex items-center gap-1.5 cursor-pointer select-none">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" style={{ opacity: layers.selected ? 1 : 0.25 }} />
            <span className="text-[10px] text-slate-400 tracking-wide">SELECTED</span>
          </span>
        )}
      </div>

      {pickedSatellite && (
        <div style={{ position: 'absolute', top: 12, right: 40, width: 250, background: 'rgba(2, 6, 23, 0.88)', border: '1px solid #1e293b', borderRadius: 8, padding: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="text-[11px] text-slate-200">SATELLITE</span>
            <button
              type="button"
              className="text-[10px] text-slate-400 hover:text-slate-200 bg-transparent border-0 cursor-pointer"
              onClick={() => {
                setPickedSatellite(null);
                if (sceneRef.current && orbitLineRef.current) {
                  sceneRef.current.remove(orbitLineRef.current);
                  orbitLineRef.current.geometry.dispose();
                  (orbitLineRef.current.material as THREE.Material).dispose();
                  orbitLineRef.current = null;
                }
              }}
            >
              CLOSE
            </button>
          </div>
          <p className="text-[12px] text-slate-100">{pickedSatellite.satname}</p>
          <p className="text-[10px] text-slate-400">ID: {pickedSatellite.satid}</p>
          <p className="text-[10px] text-slate-400">SRC: {pickedSatellite.source.toUpperCase()}</p>
          <p className="text-[10px] text-slate-400">LAT: {pickedSatellite.latitude.toFixed(3)}</p>
          <p className="text-[10px] text-slate-400">LON: {pickedSatellite.longitude.toFixed(3)}</p>
          <p className="text-[10px] text-slate-400">ALT: {pickedSatellite.altitudeKm.toFixed(1)} km</p>
          <p className="text-[10px] text-pink-300">ORBIT: -2H TO +2H</p>
        </div>
      )}

      {/* Status HUD — bottom left */}
      <div style={{ position: 'absolute', bottom: 12, left: 12, pointerEvents: 'none' }}>
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
          <p className="text-[10px] text-slate-700">ISS external feed disabled</p>
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
      <div style={{ position: 'absolute', bottom: 12, right: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <p style={{ fontSize: 10, color: '#334155', pointerEvents: 'none' }}>Drag · Scroll to zoom</p>
        <button
          type="button"
          onClick={() => setScaleMode((s) => (s === 'log' ? 'real' : 'log'))}
          className="text-[10px] px-2 py-1 rounded border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500"
          title="Toggle altitude scale"
        >
          {scaleMode === 'log' ? 'LOG' : 'REAL'}
        </button>
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
