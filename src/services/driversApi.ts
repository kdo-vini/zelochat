import type { DeliveryDriver } from '../types';
import { apiUrl, apiFetch } from '../config';
import { authHeaders, parseResponse } from './shared';

type DriversResponse = { drivers: DeliveryDriver[] };
type DriverResponse = { driver: DeliveryDriver };

export async function getDrivers(token: string): Promise<DeliveryDriver[]> {
  const response = await apiFetch(apiUrl('/api/drivers'), {
    headers: authHeaders(token),
  });

  const body = await parseResponse<DriversResponse>(response);
  return body.drivers;
}

export async function createDriver(
  token: string,
  payload: Pick<DeliveryDriver, 'name' | 'phone' | 'status'>,
): Promise<DeliveryDriver> {
  const response = await apiFetch(apiUrl('/api/drivers'), {
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
  const response = await apiFetch(apiUrl(`/api/drivers/${encodeURIComponent(id)}`), {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify(payload),
  });

  const body = await parseResponse<DriverResponse>(response);
  return body.driver;
}

export async function deleteDriver(token: string, id: string): Promise<void> {
  const response = await apiFetch(apiUrl(`/api/drivers/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    headers: authHeaders(token),
  });

  await parseResponse<{ ok: true }>(response);
}
