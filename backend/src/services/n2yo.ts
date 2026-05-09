import axios, { type AxiosInstance } from 'axios';

export class N2yoService {
  private readonly client: AxiosInstance;

  constructor(baseUrl: string) {
    this.client = axios.create({ baseURL: baseUrl, timeout: 15_000 });
  }

  async above(params: {
    observerLat: number;
    observerLng: number;
    observerAlt: number;
    searchRadius: number;
    categoryId: number;
    apiKey: string;
  }): Promise<any> {
    const { observerLat, observerLng, observerAlt, searchRadius, categoryId, apiKey } = params;
    const path = `/rest/v1/satellite/above/${observerLat}/${observerLng}/${observerAlt}/${searchRadius}/${categoryId}/&apiKey=${apiKey}`;
    const { data } = await this.client.get(path);
    return data;
  }

  async tle(satid: number, apiKey: string): Promise<any> {
    const { data } = await this.client.get(`/rest/v1/satellite/tle/${satid}&apiKey=${apiKey}`);
    return data;
  }

  async positions(params: {
    satid: number;
    observerLat: number;
    observerLng: number;
    observerAlt: number;
    seconds: number;
    apiKey: string;
  }): Promise<any> {
    const { satid, observerLat, observerLng, observerAlt, seconds, apiKey } = params;
    const { data } = await this.client.get(
      `/rest/v1/satellite/positions/${satid}/${observerLat}/${observerLng}/${observerAlt}/${seconds}/&apiKey=${apiKey}`
    );
    return data;
  }

  async visualpasses(params: {
    satid: number;
    observerLat: number;
    observerLng: number;
    observerAlt: number;
    days: number;
    minVisibility: number;
    apiKey: string;
  }): Promise<any> {
    const { satid, observerLat, observerLng, observerAlt, days, minVisibility, apiKey } = params;
    const { data } = await this.client.get(
      `/rest/v1/satellite/visualpasses/${satid}/${observerLat}/${observerLng}/${observerAlt}/${days}/${minVisibility}/&apiKey=${apiKey}`
    );
    return data;
  }

  async radiopasses(params: {
    satid: number;
    observerLat: number;
    observerLng: number;
    observerAlt: number;
    days: number;
    minElevation: number;
    apiKey: string;
  }): Promise<any> {
    const { satid, observerLat, observerLng, observerAlt, days, minElevation, apiKey } = params;
    const { data } = await this.client.get(
      `/rest/v1/satellite/radiopasses/${satid}/${observerLat}/${observerLng}/${observerAlt}/${days}/${minElevation}/&apiKey=${apiKey}`
    );
    return data;
  }
}
