import satellite from 'satellite.js';

export const isVisibleFrom = (
  line1: string,
  line2: string,
  latitude: number,
  longitude: number,
  altitude = 0
): boolean => {
  const satrec = satellite.twoline2satrec(line1, line2);
  const now = new Date();
  const pv = satellite.propagate(satrec, now);
  if (!pv.position || typeof pv.position === 'boolean') return false;
  const gmst = satellite.gstime(now);
  const ecf = satellite.eciToEcf(pv.position as satellite.EciVec3<number>, gmst);
  const look = satellite.ecfToLookAngles(
    {
      latitude: satellite.degreesToRadians(latitude),
      longitude: satellite.degreesToRadians(longitude),
      height: altitude
    },
    ecf
  );
  return look.elevation > 0;
};
