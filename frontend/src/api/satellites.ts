import { apiGet } from './client';

export const getSatellitesAbove = async (lat: number, lon: number): Promise<any> => {
  return apiGet('/rest/v1/satellite/above/' + `${lat}/${lon}/0/90/0/`);
};

export const getSatelliteTles = async (): Promise<Array<{ satid: number; name: string; line1: string; line2: string }>> => {
  const payload = await apiGet<{ tles: Array<{ satid: number; satname: string; line1: string; line2: string }> }>('/api/tle');
  return payload.tles.map((t) => ({ satid: t.satid, name: t.satname, line1: t.line1, line2: t.line2 }));
};
