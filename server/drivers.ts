import { getServiceSupabase } from './supabase.js';

export type DriverStatus = 'available' | 'busy' | 'offline';

export interface DriverRecord {
  id: string;
  name: string;
  phone: string;
  status: DriverStatus;
}

type DriverRow = {
  id: string;
  name: string;
  phone: string;
  status: DriverStatus;
};

function mapDriver(row: DriverRow): DriverRecord {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    status: row.status,
  };
}

function sanitizeName(name: string): string {
  return name.trim();
}

function sanitizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

function assertValidStatus(status: string): asserts status is DriverStatus {
  if (status !== 'available' && status !== 'busy' && status !== 'offline') {
    throw new Error('INVALID_DRIVER_STATUS');
  }
}

export async function listDrivers(empresaId: string): Promise<DriverRecord[]> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('zelochat_drivers')
    .select('id, name, phone, status')
    .eq('empresa_id', empresaId)
    .order('name', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => mapDriver(row as DriverRow));
}

export async function createDriver(
  empresaId: string,
  payload: { name: string; phone: string; status?: DriverStatus },
): Promise<DriverRecord> {
  const name = sanitizeName(payload.name);
  const phone = sanitizePhone(payload.phone);
  const status = payload.status ?? 'available';
  assertValidStatus(status);

  if (!name || !phone) {
    throw new Error('INVALID_DRIVER_PAYLOAD');
  }

  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('zelochat_drivers')
    .insert({
      empresa_id: empresaId,
      name,
      phone,
      status,
    })
    .select('id, name, phone, status')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapDriver(data as DriverRow);
}

export async function updateDriver(
  empresaId: string,
  driverId: string,
  patch: Partial<Pick<DriverRecord, 'name' | 'phone' | 'status'>>,
): Promise<DriverRecord | null> {
  const nextPatch: Record<string, string> = {
    updated_at: new Date().toISOString(),
  };

  if (patch.name !== undefined) {
    const name = sanitizeName(patch.name);
    if (!name) {
      throw new Error('INVALID_DRIVER_PAYLOAD');
    }
    nextPatch.name = name;
  }

  if (patch.phone !== undefined) {
    const phone = sanitizePhone(patch.phone);
    if (!phone) {
      throw new Error('INVALID_DRIVER_PAYLOAD');
    }
    nextPatch.phone = phone;
  }

  if (patch.status !== undefined) {
    assertValidStatus(patch.status);
    nextPatch.status = patch.status;
  }

  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('zelochat_drivers')
    .update(nextPatch)
    .eq('id', driverId)
    .eq('empresa_id', empresaId)
    .select('id, name, phone, status')
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ? mapDriver(data as DriverRow) : null;
}

export async function deleteDriver(empresaId: string, driverId: string): Promise<boolean> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('zelochat_drivers')
    .delete()
    .eq('id', driverId)
    .eq('empresa_id', empresaId)
    .select('id')
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return !!data?.id;
}
