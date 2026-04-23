import type { DeliveryDriver } from '../types';
import { apiUrl } from '../config';

type DriversResponse = { drivers: DeliveryDriver[] };
type DriverResponse = { driver: DeliveryDriver };

function authHeaders(token: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error((body as { error?: string }).error || `HTTP ${response.status}`);
  }

  return body as T;
}

export async function getDrivers(token: string): Promise<DeliveryDriver[]> {
  const response = await fetch(apiUrl('/api/drivers'), {
    headers: authHeaders(token),
  });

  const body = await parseResponse<DriversResponse>(response);
  return body.drivers;
}

export async function createDriver(
  token: string,
  payload: Pick<DeliveryDriver, 'name' | 'phone' | 'status'>,
): Promise<DeliveryDriver> {
  const response = await fetch(apiUrl('/api/drivers'), {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });

  const body = await parseResponse<DriverResponse>(response);
  return body.driver;
}

export async function updateDriver(
  token: string,
  id: string,
  payload: Partial<Pick<DeliveryDriver, 'name' | 'phone' | 'status'>>,
): Promise<DeliveryDriver> {
  const response = await fetch(apiUrl(`/api/drivers/${encodeURIComponent(id)}`), {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });

  const body = await parseResponse<DriverResponse>(response);
  return body.driver;
}

export async function deleteDriver(token: string, id: string): Promise<void> {
  const response = await fetch(apiUrl(`/api/drivers/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    headers: authHeaders(token),
  });

  await parseResponse<{ ok: true }>(response);
}
