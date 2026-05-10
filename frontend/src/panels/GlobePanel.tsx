/* eslint-disable */
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import * as satellite from 'satellite.js';
import { RefreshCcw, X } from 'lucide-react';
import { getSatelliteTle, getSatellitesAbove, getSatelliteTles } from '../api/satellites';
import { useGeneralConfig } from '../contexts/GeneralConfigContext';
import { useSelected } from '../contexts/SelectedContext';

// ── Constants ─────────────────────────────────────────────────────────────────
const SAT_POLL_MS  = 60_000;
const TLE_POLL_MS  = 120_000; // refresh TLE catalog every 2 min
const TLE_RECOMPUTE_MS = 1_000; // re-propagate local TLE positions every 1 s
const ISS_SATID = 26700;
const ORBIT_RANGE_MAX_SECONDS = 30 * 24 * 3600;
const DEG         = Math.PI / 180;
const J2000       = Date.UTC(2000, 0, 1, 12); // ms
const EARTH_RADIUS_KM = 6371;
const MOON_RADIUS_EARTH = 1737.4 / EARTH_RADIUS_KM;
const SUN_RADIUS_EARTH = 695700 / EARTH_RADIUS_KM;
const MOON_DISTANCE_EARTH = 384400 / EARTH_RADIUS_KM;
const SUN_DISTANCE_EARTH = 149597870 / EARTH_RADIUS_KM;

type BrightStar = { name: string; raHours: number; decDeg: number; mag: number };
const BRIGHT_STARS: BrightStar[] = [
  // Orion
  { name: 'Betelgeuse', raHours: 5.9195, decDeg: 7.4071, mag: 0.5 },
  { name: 'Rigel', raHours: 5.2423, decDeg: -8.2017, mag: 0.13 },
  { name: 'Bellatrix', raHours: 5.4189, decDeg: 6.3497, mag: 1.64 },
  { name: 'Saiph', raHours: 5.7959, decDeg: -9.6696, mag: 2.06 },
  { name: 'Alnitak', raHours: 5.6793, decDeg: -1.9426, mag: 1.74 },
  { name: 'Alnilam', raHours: 5.6036, decDeg: -1.2019, mag: 1.69 },
  { name: 'Mintaka', raHours: 5.5334, decDeg: -0.2991, mag: 2.25 },
  { name: 'Meissa', raHours: 5.5856, decDeg: 9.9342, mag: 3.39 },
  { name: 'Hatysa', raHours: 5.4079, decDeg: -2.3971, mag: 2.75 },
  { name: 'Tabit', raHours: 4.8307, decDeg: 6.9613, mag: 3.59 },
  // Ursa Major
  { name: 'Dubhe', raHours: 11.0621, decDeg: 61.7508, mag: 1.79 },
  { name: 'Merak', raHours: 11.0307, decDeg: 56.3824, mag: 2.37 },
  { name: 'Phecda', raHours: 11.8972, decDeg: 53.6948, mag: 2.43 },
  { name: 'Megrez', raHours: 12.257, decDeg: 57.0326, mag: 3.32 },
  { name: 'Alioth', raHours: 12.9005, decDeg: 55.9598, mag: 1.76 },
  { name: 'Mizar', raHours: 13.3987, decDeg: 54.9254, mag: 2.23 },
  { name: 'Alkaid', raHours: 13.7923, decDeg: 49.3133, mag: 1.86 },
  // Ursa Minor
  { name: 'Polaris', raHours: 2.5303, decDeg: 89.2641, mag: 1.98 },
  { name: 'Kochab', raHours: 14.8451, decDeg: 74.1555, mag: 2.08 },
  { name: 'Pherkad', raHours: 15.3455, decDeg: 71.834, mag: 3.0 },
  { name: 'Yildun', raHours: 17.5369, decDeg: 86.5861, mag: 4.35 },
  { name: 'Epsilon UMi', raHours: 16.7662, decDeg: 82.0373, mag: 4.21 },
  { name: 'Zeta UMi', raHours: 15.7343, decDeg: 77.7945, mag: 4.32 },
  { name: 'Eta UMi', raHours: 16.2918, decDeg: 75.7553, mag: 4.95 },
  // Cassiopeia
  { name: 'Schedar', raHours: 0.6751, decDeg: 56.5373, mag: 2.24 },
  { name: 'Caph', raHours: 0.1529, decDeg: 59.1498, mag: 2.28 },
  { name: 'Gamma Cas', raHours: 0.9451, decDeg: 60.7167, mag: 2.15 },
  { name: 'Ruchbah', raHours: 1.4303, decDeg: 60.2353, mag: 2.68 },
  { name: 'Segin', raHours: 2.2939, decDeg: 63.6701, mag: 3.37 },
  // Cygnus
  { name: 'Deneb', raHours: 20.6905, decDeg: 45.2803, mag: 1.25 },
  { name: 'Sadr', raHours: 20.3705, decDeg: 40.2567, mag: 2.23 },
  { name: 'Albireo', raHours: 19.512, decDeg: 27.9597, mag: 3.05 },
  { name: 'Gienah Cyg', raHours: 20.7702, decDeg: 33.9703, mag: 2.46 },
  // Scorpius
  { name: 'Antares', raHours: 16.4901, decDeg: -26.432, mag: 1.06 },
  { name: 'Shaula', raHours: 17.5601, decDeg: -37.1038, mag: 1.62 },
  { name: 'Sargas', raHours: 17.6219, decDeg: -42.9978, mag: 1.86 },
  { name: 'Dschubba', raHours: 16.0056, decDeg: -22.6217, mag: 2.29 },
  { name: 'Acrab', raHours: 16.0906, decDeg: -19.8068, mag: 2.56 },
  // Leo
  { name: 'Regulus', raHours: 10.1395, decDeg: 11.9672, mag: 1.35 },
  { name: 'Denebola', raHours: 11.8177, decDeg: 14.5719, mag: 2.14 },
  { name: 'Algieba', raHours: 10.3329, decDeg: 19.8415, mag: 2.08 },
  { name: 'Zosma', raHours: 11.2351, decDeg: 20.5237, mag: 2.56 },
  // Taurus
  { name: 'Aldebaran', raHours: 4.5987, decDeg: 16.5093, mag: 0.85 },
  { name: 'Elnath', raHours: 5.4382, decDeg: 28.6074, mag: 1.65 },
  { name: 'Alcyone', raHours: 3.7914, decDeg: 24.1051, mag: 2.85 },
  // Gemini
  { name: 'Pollux', raHours: 7.7553, decDeg: 28.0262, mag: 1.14 },
  { name: 'Castor', raHours: 7.5767, decDeg: 31.8883, mag: 1.58 },
  { name: 'Alhena', raHours: 6.6285, decDeg: 16.3993, mag: 1.93 },
  // Canis Major / Minor
  { name: 'Sirius', raHours: 6.7525, decDeg: -16.7161, mag: -1.46 },
  { name: 'Adhara', raHours: 6.9771, decDeg: -28.9721, mag: 1.5 },
  { name: 'Wezen', raHours: 7.1399, decDeg: -26.3932, mag: 1.83 },
  { name: 'Mirzam', raHours: 6.3783, decDeg: -17.9559, mag: 1.98 },
  { name: 'Procyon', raHours: 7.655, decDeg: 5.225, mag: 0.34 },
  // Lyra / Aquila
  { name: 'Canopus', raHours: 6.3992, decDeg: -52.6957, mag: -0.74 },
  { name: 'Arcturus', raHours: 14.261, decDeg: 19.1825, mag: -0.05 },
  { name: 'Vega', raHours: 18.6156, decDeg: 38.7837, mag: 0.03 },
  { name: 'Sheliak', raHours: 18.8347, decDeg: 33.3627, mag: 3.52 },
  { name: 'Sulafat', raHours: 18.9824, decDeg: 32.6896, mag: 3.25 },
  { name: 'Altair', raHours: 19.8464, decDeg: 8.8683, mag: 0.77 },
  { name: 'Tarazed', raHours: 19.7709, decDeg: 10.6133, mag: 2.72 },
  { name: 'Alshain', raHours: 19.9219, decDeg: 6.4068, mag: 3.71 },
  // Sagittarius
  { name: 'Kaus Australis', raHours: 18.4029, decDeg: -34.3846, mag: 1.79 },
  { name: 'Nunki', raHours: 18.9211, decDeg: -26.2967, mag: 2.05 },
  { name: 'Ascella', raHours: 19.0435, decDeg: -29.88, mag: 2.6 },
  // Pegasus / Andromeda
  { name: 'Markab', raHours: 23.0793, decDeg: 15.2053, mag: 2.49 },
  { name: 'Scheat', raHours: 23.0629, decDeg: 28.0828, mag: 2.44 },
  { name: 'Algenib', raHours: 0.2206, decDeg: 15.1836, mag: 2.84 },
  { name: 'Alpheratz', raHours: 0.1398, decDeg: 29.0904, mag: 2.06 },
  { name: 'Mirach', raHours: 1.1622, decDeg: 35.6206, mag: 2.06 },
  // Crux / Centaurus
  { name: 'Acrux', raHours: 12.4433, decDeg: -63.0991, mag: 0.76 },
  { name: 'Mimosa', raHours: 12.7953, decDeg: -59.6888, mag: 1.25 },
  { name: 'Gacrux', raHours: 12.5194, decDeg: -57.1132, mag: 1.63 },
  { name: 'Imai', raHours: 12.2524, decDeg: -58.7489, mag: 2.79 },
  { name: 'Ginan', raHours: 12.7713, decDeg: -57.3531, mag: 4.04 },
  { name: 'Hadar', raHours: 14.0637, decDeg: -60.373, mag: 0.61 },
  { name: 'Rigil Kent', raHours: 14.6601, decDeg: -60.8356, mag: -0.27 },
  { name: 'Muhlifain', raHours: 14.986, decDeg: -42.1042, mag: 2.06 },
  { name: 'Menkent', raHours: 14.1114, decDeg: -36.370, mag: 2.06 },
  { name: 'Epsilon Cen', raHours: 13.6648, decDeg: -53.4664, mag: 2.30 },
  { name: 'Zeta Cen', raHours: 13.9257, decDeg: -47.2884, mag: 2.55 },
  // Carina / Vela / Puppis (major southern Milky Way constellations)
  { name: 'Canopus', raHours: 6.3992, decDeg: -52.6957, mag: -0.74 },
  { name: 'Miaplacidus', raHours: 9.2204, decDeg: -69.7172, mag: 1.67 },
  { name: 'Avior', raHours: 8.3752, decDeg: -59.5095, mag: 1.86 },
  { name: 'Aspidiske', raHours: 9.2848, decDeg: -59.2752, mag: 2.21 },
  { name: 'Vela Regor', raHours: 8.1589, decDeg: -47.3366, mag: 1.75 },
  { name: 'Suhail', raHours: 9.1333, decDeg: -43.4326, mag: 2.21 },
  { name: 'Markeb', raHours: 9.3686, decDeg: -55.0107, mag: 2.47 },
  { name: 'Naos', raHours: 8.0597, decDeg: -40.0031, mag: 2.25 },
  { name: 'Ahadi', raHours: 7.8216, decDeg: -24.8598, mag: 2.71 },
  // Triangulum Australe
  { name: 'Atria', raHours: 16.8111, decDeg: -69.0277, mag: 1.91 },
  { name: 'Beta TrA', raHours: 15.9191, decDeg: -63.4307, mag: 2.85 },
  { name: 'Gamma TrA', raHours: 15.3152, decDeg: -68.6795, mag: 2.89 },
  // Pavo / Tucana / Hydrus
  { name: 'Peacock', raHours: 20.4275, decDeg: -56.7351, mag: 1.94 },
  { name: 'Beta Pav', raHours: 20.7493, decDeg: -66.2032, mag: 3.42 },
  { name: 'Gamma Pav', raHours: 21.4407, decDeg: -65.3662, mag: 4.22 },
  { name: 'Alpha Tuc', raHours: 22.3084, decDeg: -60.2595, mag: 2.87 },
  { name: 'Beta Tuc', raHours: 0.5257, decDeg: -62.9582, mag: 4.37 },
  { name: 'Alpha Hyi', raHours: 1.9795, decDeg: -61.5698, mag: 2.86 },
  { name: 'Beta Hyi', raHours: 0.4281, decDeg: -77.2542, mag: 2.80 },
  // Misc bright anchors
  { name: 'Capella', raHours: 5.2782, decDeg: 45.998, mag: 0.08 },
  { name: 'Achernar', raHours: 1.6286, decDeg: -57.2368, mag: 0.46 },
  { name: 'Spica', raHours: 13.4199, decDeg: -11.1614, mag: 0.97 },
  { name: 'Fomalhaut', raHours: 22.9608, decDeg: -29.6222, mag: 1.16 },
  { name: 'Alnair', raHours: 22.1372, decDeg: -46.9609, mag: 1.74 },
  { name: 'Alphard', raHours: 9.4598, decDeg: -8.6586, mag: 1.98 },
  { name: 'Mirfak', raHours: 3.4054, decDeg: 49.8612, mag: 1.79 },
  { name: 'Algol', raHours: 3.1361, decDeg: 40.9556, mag: 2.12 },
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

function sliderToSeconds(value: number): number {
  if (value <= 0) return 0;
  const t = Math.min(1, Math.max(0, value / 100));
  const k = 6; // logarithmic curve strength
  return Math.round(ORBIT_RANGE_MAX_SECONDS * ((Math.exp(k * t) - 1) / (Math.exp(k) - 1)));
}

function fmtDuration(seconds: number): string {
  if (seconds <= 0) return '0s';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

function tleMeanMotionRevPerDay(line2: string): number | null {
  const parts = line2.trim().split(/\s+/);
  if (parts.length === 0) return null;
  const mm = Number(parts[parts.length - 1]);
  if (!Number.isFinite(mm) || mm <= 0) return null;
  return mm;
}

function orbitSampleStepSeconds(spanSeconds: number, line2: string): number {
  const meanMotion = tleMeanMotionRevPerDay(line2);
  const periodSec = meanMotion ? 86400 / meanMotion : 5400; // fallback ~90 min
  const pointsPerOrbit = 240; // smooth enough for fast movers
  const targetFromOrbits = Math.max(180, Math.round((spanSeconds / periodSec) * pointsPerOrbit));
  const clampedTarget = Math.min(12000, targetFromOrbits);
  return Math.max(1, Math.ceil(spanSeconds / clampedTarget));
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
  source: 'above' | 'tle' | 'selected';
}

function propagateNowFromTle(tle: TleEntry): { latitude: number; longitude: number; altitudeKm: number } | null {
  try {
    const now = new Date();
    const satrec = satellite.twoline2satrec(tle.line1, tle.line2);
    const pv = satellite.propagate(satrec, now);
    if (!pv || !pv.position || typeof pv.position === 'boolean') return null;
    const gmst = satellite.gstime(now);
    const geo = satellite.eciToGeodetic(pv.position as satellite.EciVec3<number>, gmst);
    return {
      latitude: satellite.degreesLat(geo.latitude),
      longitude: satellite.degreesLong(geo.longitude),
      altitudeKm: geo.height
    };
  } catch {
    return null;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────
const GlobePanel: React.FC = () => {
  const mountRef = useRef<HTMLDivElement>(null);
  const { generalConfig } = useGeneralConfig();
  const { items: selectedItems, setItems: setSelectedItems } = useSelected();

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
  const orbitLinesRef       = useRef<Map<number, THREE.Line>>(new Map());
  const drawOrbitTrackRef   = useRef<((satid: number) => Promise<void>) | null>(null);
  const orbitRequestRef     = useRef(0);
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
  const [hoveredSatellite, setHoveredSatellite] = useState<PickedSatellite | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const [orbitPastSlider, setOrbitPastSlider] = useState(22);
  const [orbitFutureSlider, setOrbitFutureSlider] = useState(22);
  const orbitPastSeconds = sliderToSeconds(orbitPastSlider);
  const orbitFutureSeconds = sliderToSeconds(orbitFutureSlider);
  const orbitPastSecondsRef = useRef(orbitPastSeconds);
  const orbitFutureSecondsRef = useRef(orbitFutureSeconds);

  const ensureSelected = (picked: PickedSatellite) => {
    const key = `satellite:${picked.satid}`;
    setSelectedItems((prev: any) => {
      const exists = prev.some((s: any) => `${s.entity_type}:${s.id}` === key);
      if (exists) return prev;
      return [
        ...prev,
        {
          id: picked.satid,
          entity_type: 'satellite',
          name: picked.satname,
          latitude: picked.latitude,
          longitude: picked.longitude,
          altitudeKm: picked.altitudeKm
        }
      ];
    });
  };

  const toggleSelectedFromGlobe = (picked: PickedSatellite) => {
    const key = `satellite:${picked.satid}`;
    let removed = false;
    setSelectedItems((prev: any) => {
      const exists = prev.some((s: any) => `${s.entity_type}:${s.id}` === key);
      if (!exists) {
        return [
          ...prev,
          {
            id: picked.satid,
            entity_type: 'satellite',
            name: picked.satname,
            latitude: picked.latitude,
            longitude: picked.longitude,
            altitudeKm: picked.altitudeKm
          }
        ];
      }
      removed = true;
      return prev.filter((s: any) => `${s.entity_type}:${s.id}` !== key);
    });
    if (removed) {
      setPickedSatellite((current) => (current?.satid === picked.satid ? null : current));
    } else {
      setPickedSatellite(picked);
    }
  };

  const withLivePosition = (picked: PickedSatellite): PickedSatellite => {
    const tle = tleBySatidRef.current.get(picked.satid);
    if (!tle) return picked;
    const live = propagateNowFromTle(tle);
    if (!live) return picked;
    return {
      ...picked,
      latitude: live.latitude,
      longitude: live.longitude,
      altitudeKm: live.altitudeKm,
      source: 'tle'
    };
  };

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
    let isPointerDown = false;
    let hoverSelectable = false;
    const applyCursor = () => {
      if (hoverSelectable) {
        renderer.domElement.style.cursor = 'pointer';
        return;
      }
      renderer.domElement.style.cursor = isPointerDown ? 'grabbing' : 'grab';
    };
    const onDown = () => {
      controls.autoRotate = false;
      isPointerDown = true;
      applyCursor();
    };
    const onUp   = () => {
      controls.autoRotate = orbitRef.current;
      isPointerDown = false;
      applyCursor();
    };
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
        const tle = tleBySatidRef.current.get(sats[i].satid);
        const live = tle ? propagateNowFromTle(tle) : null;
        if (!live) continue;
        const { latitude: satlat, longitude: satlng, altitudeKm: satalt } = live;
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

    const pointer = new THREE.Vector2();
    const meshRaycaster = new THREE.Raycaster();
    let pointerDownX = 0;
    let pointerDownY = 0;

    const drawOrbitTrack = async (satid: number) => {
      const reqId = ++orbitRequestRef.current;
      const previous = orbitLinesRef.current.get(satid);
      if (previous) {
        scene.remove(previous);
        previous.geometry.dispose();
        (previous.material as THREE.Material).dispose();
        orbitLinesRef.current.delete(satid);
      }

      let tle = tleBySatidRef.current.get(satid);
      if (!tle) {
        try {
          const fetched = await getSatelliteTle(satid);
          if (reqId !== orbitRequestRef.current) return;
          tleBySatidRef.current.set(satid, fetched);
          tle = fetched;
        } catch {
          return;
        }
      }
      if (!tle) return;
      try {
        const satrec = satellite.twoline2satrec(tle.line1, tle.line2);
        const coords: number[] = [];
        const center = Date.now();
        const pastSec = orbitPastSecondsRef.current;
        const futureSec = orbitFutureSecondsRef.current;
        const totalSpan = Math.max(1, pastSec + futureSec);
        const stepSeconds = orbitSampleStepSeconds(totalSpan, tle.line2);
        for (let offsetSec = -pastSec; offsetSec <= futureSec; offsetSec += stepSeconds) {
          const when = new Date(center + offsetSec * 1000);
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
        if (coords.length >= 6) {
          if (reqId !== orbitRequestRef.current) return;
          const orbitGeom = new THREE.BufferGeometry();
          orbitGeom.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
          const orbitMat = new THREE.LineBasicMaterial({ color: 0xff4d6d, transparent: true, opacity: 0.9 });
          const orbitLine = new THREE.Line(orbitGeom, orbitMat);
          scene.add(orbitLine);
          orbitLinesRef.current.set(satid, orbitLine);
        }
      } catch {
        // Ignore malformed TLEs.
      }
    };
    drawOrbitTrackRef.current = drawOrbitTrack;

    const pickAt = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const maxPx = 12;
      const maxPxSq = maxPx * maxPx;
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      meshRaycaster.setFromCamera(pointer, camera);

      // Priority 1: explicit selected markers (exact identity match)
      const markerMeshes: THREE.Object3D[] = [];
      for (const grp of selectedMarkersRef.current.values()) {
        markerMeshes.push(...grp.children);
      }
      if (markerMeshes.length > 0) {
        const markerHit = meshRaycaster.intersectObjects(markerMeshes, true)[0];
        if (markerHit) {
          let node: THREE.Object3D | null = markerHit.object;
          while (node && !node.userData?.pickedSatellite) node = node.parent;
          const picked = node?.userData?.pickedSatellite as PickedSatellite | undefined;
          if (picked) {
            const livePicked = withLivePosition(picked);
            toggleSelectedFromGlobe(livePicked);
            return;
          }
        }
      }

      let bestItem: PickedSatellite | null = null;
      let bestDistSq = Number.POSITIVE_INFINITY;
      let bestDepth = Number.POSITIVE_INFINITY;
      const consider = (item: PickedSatellite) => {
        const v = latLonToVec3(
          item.latitude,
          item.longitude,
          scaleModeRef.current === 'real' ? altToRadiusReal(item.altitudeKm) : altToRadius(item.altitudeKm)
        ).project(camera);
        if (v.z < -1 || v.z > 1) return;
        const sx = ((v.x + 1) / 2) * rect.width;
        const sy = ((-v.y + 1) / 2) * rect.height;
        const dx = sx - px;
        const dy = sy - py;
        const distSq = dx * dx + dy * dy;
        if (distSq > maxPxSq) return;
        if (distSq < bestDistSq || (Math.abs(distSq - bestDistSq) < 1e-6 && v.z < bestDepth)) {
          bestItem = item;
          bestDistSq = distSq;
          bestDepth = v.z;
        }
      };

      for (const item of renderedAboveRef.current) consider(item);
      for (const item of renderedTleRef.current) consider(item);

      if (bestItem) {
        const livePicked = withLivePosition(bestItem);
        setPickedSatellite(livePicked);
        ensureSelected(livePicked);
      }
    };
    const onPointerDownPick = (event: PointerEvent) => {
      pointerDownX = event.clientX;
      pointerDownY = event.clientY;
    };
    const onPointerMovePick = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const maxPx = 12;
      const maxPxSq = maxPx * maxPx;
      let bestItem: PickedSatellite | null = null;
      let bestDistSq = Number.POSITIVE_INFINITY;
      let bestDepth = Number.POSITIVE_INFINITY;
      const check = (item: PickedSatellite) => {
        const v = latLonToVec3(
          item.latitude,
          item.longitude,
          scaleModeRef.current === 'real' ? altToRadiusReal(item.altitudeKm) : altToRadius(item.altitudeKm)
        ).project(camera);
        if (v.z < -1 || v.z > 1) return false;
        const sx = ((v.x + 1) / 2) * rect.width;
        const sy = ((-v.y + 1) / 2) * rect.height;
        const dx = sx - px;
        const dy = sy - py;
        const distSq = dx * dx + dy * dy;
        if (distSq > maxPxSq) return false;
        if (distSq < bestDistSq || (Math.abs(distSq - bestDistSq) < 1e-6 && v.z < bestDepth)) {
          bestItem = item;
          bestDistSq = distSq;
          bestDepth = v.z;
        }
        return true;
      };
      for (const item of renderedAboveRef.current) {
        check(item);
      }
      for (const item of renderedTleRef.current) {
        check(item);
      }
      hoverSelectable = Boolean(bestItem);
      setHoveredSatellite(bestItem);
      setHoverPos(bestItem ? { x: event.clientX, y: event.clientY } : null);
      applyCursor();
    };
    const onPointerUpPick = (event: PointerEvent) => {
      const dx = Math.abs(event.clientX - pointerDownX);
      const dy = Math.abs(event.clientY - pointerDownY);
      // Ignore drag release from orbit controls; only treat near-stationary release as selection.
      if (dx > 6 || dy > 6) return;
      pickAt(event.clientX, event.clientY);
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDownPick);
    renderer.domElement.addEventListener('pointerup', onPointerUpPick);
    renderer.domElement.addEventListener('pointermove', onPointerMovePick);

    // Resize
    const resize = () => {
      const width = Math.max(1, el.clientWidth);
      const height = Math.max(1, el.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(window.devicePixelRatio || 1);
      renderer.setSize(width, height, false);
    };
    const ro = new ResizeObserver(() => resize());
    const onWindowResize = () => resize();
    ro.observe(el);
    window.addEventListener('resize', onWindowResize);
    resize();

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      window.removeEventListener('resize', onWindowResize);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup',   onUp);
      renderer.domElement.removeEventListener('pointerdown', onPointerDownPick);
      renderer.domElement.removeEventListener('pointerup', onPointerUpPick);
      renderer.domElement.removeEventListener('pointermove', onPointerMovePick);
      setHoveredSatellite(null);
      setHoverPos(null);
      controls.dispose();
      renderer.dispose();
      earthTex.dispose();
      moonTex.dispose();
      for (const line of orbitLinesRef.current.values()) {
        scene.remove(line);
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      }
      orbitLinesRef.current.clear();
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

  // ISS marker from local TLE propagation
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let active = true;
    const tick = async () => {
      let tle = tleBySatidRef.current.get(ISS_SATID);
      if (!tle) {
        try {
          const fetched = await getSatelliteTle(ISS_SATID);
          tleBySatidRef.current.set(ISS_SATID, fetched);
          tle = fetched;
        } catch {
          if (issGrpRef.current) issGrpRef.current.visible = false;
          if (active) timer = setTimeout(tick, 5000);
          return;
        }
      }
      const live = tle ? propagateNowFromTle(tle) : null;
      if (!live) {
        if (issGrpRef.current) issGrpRef.current.visible = false;
      } else {
        issPosRef.current = latLonToVec3(
          live.latitude,
          live.longitude,
          scaleModeRef.current === 'real' ? altToRadiusReal(live.altitudeKm) : altToRadius(live.altitudeKm)
        );
        setIssInfo({ lat: live.latitude, lon: live.longitude, updated: new Date() });
        setIssErr(false);
        if (issGrpRef.current) issGrpRef.current.visible = layerStateRef.current.iss;
      }
      if (active) timer = setTimeout(tick, 1000);
    };
    tick();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [scaleMode]);

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
          if (visibleAboveRef.current.length > 0 && satUpdateRef.current) {
            satUpdateRef.current(visibleAboveRef.current);
          }
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
      if (visibleAboveRef.current.length > 0 && satUpdateRef.current) {
        satUpdateRef.current(visibleAboveRef.current);
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
      const tle = tleBySatidRef.current.get(item.id);
      const live = tle ? propagateNowFromTle(tle) : null;
      const latitude = live?.latitude ?? item.latitude!;
      const longitude = live?.longitude ?? item.longitude!;
      const altitudeKm = live?.altitudeKm ?? (typeof item.altitudeKm === 'number' ? item.altitudeKm : 0);
      const radius = scaleModeRef.current === 'real' ? altToRadiusReal(altitudeKm) : altToRadius(altitudeKm);

      if (existing.has(k)) {
        const grp = existing.get(k)!;
        grp.userData.pickedSatellite = {
          satid: item.id,
          satname: item.name,
          latitude,
          longitude,
          altitudeKm,
          source: 'selected'
        } as PickedSatellite;
        grp.position.copy(latLonToVec3(latitude, longitude, radius));
        grp.visible = layerStateRef.current.selected;
        continue;
      }

      const grp = new THREE.Group();
      grp.userData.pickedSatellite = {
        satid: item.id,
        satname: item.name,
        latitude,
        longitude,
        altitudeKm,
        source: 'selected'
      } as PickedSatellite;
      const markerMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.01, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0x00e87a }),
      );
      markerMesh.scale.setScalar(pickedSatellite?.satid === item.id ? 1.8 : 1);
      grp.add(markerMesh);
      grp.position.copy(latLonToVec3(latitude, longitude, radius));
      grp.visible = layerStateRef.current.selected;
      scene.add(grp);
      existing.set(k, grp);
    }
  }, [selectedItems, scaleMode, pickedSatellite?.satid]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let active = true;

    const tick = () => {
      const existing = selectedMarkersRef.current;
      for (const item of selectedItems) {
        if (item.latitude == null || item.longitude == null) continue;
        const key = `${item.entity_type}:${item.id}`;
        const grp = existing.get(key);
        if (!grp) continue;
        const tle = tleBySatidRef.current.get(item.id);
        const live = tle ? propagateNowFromTle(tle) : null;
        const latitude = live?.latitude ?? item.latitude;
        const longitude = live?.longitude ?? item.longitude;
        const altitudeKm = live?.altitudeKm ?? (typeof item.altitudeKm === 'number' ? item.altitudeKm : 0);
        const radius = scaleModeRef.current === 'real' ? altToRadiusReal(altitudeKm) : altToRadius(altitudeKm);
        grp.position.copy(latLonToVec3(latitude, longitude, radius));
        grp.userData.pickedSatellite = {
          satid: item.id,
          satname: item.name,
          latitude,
          longitude,
          altitudeKm,
          source: 'selected'
        } as PickedSatellite;
      }
      if (active) timer = setTimeout(tick, 1500);
    };

    tick();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [selectedItems, scaleMode]);

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

  useEffect(() => {
    orbitPastSecondsRef.current = orbitPastSeconds;
    orbitFutureSecondsRef.current = orbitFutureSeconds;
    if (pickedSatellite) {
      drawOrbitTrackRef.current?.(pickedSatellite.satid);
    }
  }, [orbitPastSeconds, orbitFutureSeconds, pickedSatellite]);

  useEffect(() => {
    if (pickedSatellite) {
      drawOrbitTrackRef.current?.(pickedSatellite.satid);
      return;
    }
    orbitRequestRef.current += 1;
  }, [pickedSatellite]);

  useEffect(() => {
    const selectedSatIds = new Set(selectedItems.map((s) => s.id));
    if (!sceneRef.current) return;
    for (const [satid, line] of orbitLinesRef.current.entries()) {
      if (selectedSatIds.has(satid)) continue;
      sceneRef.current.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
      orbitLinesRef.current.delete(satid);
    }
  }, [selectedItems]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: '100%', background: '#05080f', userSelect: 'none' }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      {/* Legend — top left */}
      <div className="globe-legend">
        <div onClick={() => setLayers((s) => ({ ...s, sun: !s.sun }))} className={`globe-legend-item ${layers.sun ? '' : 'is-off'}`}>
          <span className="globe-legend-dot sun" />
          <span className="globe-legend-label">SUN</span>
        </div>
        <div onClick={() => setLayers((s) => ({ ...s, moon: !s.moon }))} className={`globe-legend-item ${layers.moon ? '' : 'is-off'}`}>
          <span className="globe-legend-dot moon" />
          <span className="globe-legend-label">MOON</span>
        </div>
        {(satCount !== null && satCount > 0) || (tleCount !== null && tleCount > 0) ? (
          <>
            <div onClick={() => setLayers((s) => ({ ...s, leo: !s.leo }))} className={`globe-legend-item ${layers.leo ? '' : 'is-off'}`}>
              <span className="globe-legend-dot leo" />
              <span className="globe-legend-label">LEO</span>
            </div>
            <div onClick={() => setLayers((s) => ({ ...s, meo: !s.meo }))} className={`globe-legend-item ${layers.meo ? '' : 'is-off'}`}>
              <span className="globe-legend-dot meo" />
              <span className="globe-legend-label">MEO</span>
            </div>
            <div onClick={() => setLayers((s) => ({ ...s, geo: !s.geo }))} className={`globe-legend-item ${layers.geo ? '' : 'is-off'}`}>
              <span className="globe-legend-dot geo" />
              <span className="globe-legend-label">GEO</span>
            </div>
            <div onClick={() => setLayers((s) => ({ ...s, notVisible: !s.notVisible }))} className={`globe-legend-item ${layers.notVisible ? '' : 'is-off'}`}>
              <span className="globe-legend-dot not-visible" />
              <span className="globe-legend-label">NOT VISIBLE</span>
            </div>
          </>
        ) : null}
        <div onClick={() => setLayers((s) => ({ ...s, iss: !s.iss }))} className={`globe-legend-item ${layers.iss ? '' : 'is-off'}`}>
          <span className="globe-legend-dot iss" />
          <span className="globe-legend-label">ISS</span>
        </div>
        {userPos && (
          <div onClick={() => setLayers((s) => ({ ...s, user: !s.user }))} className={`globe-legend-item ${layers.user ? '' : 'is-off'}`}>
            <span className="globe-legend-dot user" />
            <span className="globe-legend-label">YOU</span>
          </div>
        )}
        {selectedItems.some(i => i.latitude != null) && (
          <div onClick={() => setLayers((s) => ({ ...s, selected: !s.selected }))} className={`globe-legend-item ${layers.selected ? '' : 'is-off'}`}>
            <span className="globe-legend-dot selected" />
            <span className="globe-legend-label">SELECTED</span>
          </div>
        )}
      </div>

      {pickedSatellite && (
        <div style={{ position: 'absolute', top: 12, right: 40, width: 250, background: 'rgba(2, 6, 23, 0.88)', border: '1px solid #1e293b', borderRadius: 8, padding: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="text-[11px] text-slate-200">SATELLITE</span>
            <button
              type="button"
              className="inline-flex items-center justify-center text-slate-400 hover:text-slate-200 bg-transparent border-0 cursor-pointer p-0"
              style={{ width: 'auto' }}
              onClick={() => {
                setPickedSatellite(null);
                if (sceneRef.current) {
                  for (const line of orbitLinesRef.current.values()) {
                    sceneRef.current.remove(line);
                    line.geometry.dispose();
                    (line.material as THREE.Material).dispose();
                  }
                  orbitLinesRef.current.clear();
                }
              }}
            >
              <X size={14} />
            </button>
          </div>
          <p className="text-[12px] text-slate-100">{pickedSatellite.satname}</p>
          <p className="text-[10px] text-slate-400">ID: {pickedSatellite.satid}</p>
          <p className="text-[10px] text-slate-400">SRC: {pickedSatellite.source.toUpperCase()}</p>
          <p className="text-[10px] text-slate-400">LAT: {pickedSatellite.latitude.toFixed(3)}</p>
          <p className="text-[10px] text-slate-400">LON: {pickedSatellite.longitude.toFixed(3)}</p>
          <p className="text-[10px] text-slate-400">ALT: {pickedSatellite.altitudeKm.toFixed(1)} km</p>
          <p className="text-[10px] text-pink-300">
            ORBIT: -{fmtDuration(orbitPastSeconds)} TO +{fmtDuration(orbitFutureSeconds)}
          </p>
        </div>
      )}
      {hoveredSatellite && hoverPos && (
        <div className="sat-hover-tag" style={{ left: hoverPos.x, top: hoverPos.y }}>
          {hoveredSatellite.satname} #{hoveredSatellite.satid}
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
        <label style={{ fontSize: 10, color: '#94a3b8', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          Past {fmtDuration(orbitPastSeconds)}
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={orbitPastSlider}
            onChange={(e) => setOrbitPastSlider(Number(e.target.value))}
            style={{ width: 120, direction: 'rtl' }}
          />
        </label>
        <label style={{ fontSize: 10, color: '#94a3b8', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          Future {fmtDuration(orbitFutureSeconds)}
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={orbitFutureSlider}
            onChange={(e) => setOrbitFutureSlider(Number(e.target.value))}
            style={{ width: 120 }}
          />
        </label>
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
