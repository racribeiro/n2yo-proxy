export interface OrbitalObject {
  satid: number;
  satname: string;
  satlat?: number;
  satlng?: number;
  satalt?: number;
  category?: string;
  owner?: string;
  country?: string;
  launchDate?: string;
  lastSeenAt: string;
}

export interface SelectedItem {
  id: number;
  entity_type: string;
  name: string;
  latitude?: number;
  longitude?: number;
}
