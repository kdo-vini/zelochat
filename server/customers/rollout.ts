import type { Request } from 'express';
import { AccessControlError, requireActorAccess, type ActorAccessContext } from '../accessControl.js';
import { getServiceSupabase } from '../supabase.js';

export const CRM_FEATURES = ['crm', 'campaigns', 'automations'] as const;
export type CrmFeature = typeof CRM_FEATURES[number];
export type CrmRolloutFlags = Record<CrmFeature, boolean>;
export interface RolloutOutboundJob { jobType?: 'campaign' | 'automation'; }
export const DEFAULT_CRM_ROLLOUT_FLAGS: CrmRolloutFlags = { crm: false, campaigns: false, automations: false };
export class CrmFeatureDisabledError extends Error { readonly code = 'CRM_FEATURE_DISABLED'; constructor(readonly feature: CrmFeature) { super('CRM_FEATURE_DISABLED'); this.name = 'CrmFeatureDisabledError'; } }
export function normalizeCrmRolloutFlags(row: unknown): CrmRolloutFlags { const value = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>; return { crm: value.crm_enabled === true, campaigns: value.campaigns_enabled === true, automations: value.automations_enabled === true }; }
export function isCrmFeatureEnabled(flags: CrmRolloutFlags, feature: CrmFeature): boolean { return flags[feature] === true; }
export function requiredOutboundFeature(job: RolloutOutboundJob): CrmFeature { return job.jobType === 'automation' ? 'automations' : job.jobType === 'campaign' ? 'campaigns' : 'crm'; }
export function isOutboundJobAllowed(flags: CrmRolloutFlags, job: RolloutOutboundJob): boolean { return flags.crm === true && flags[requiredOutboundFeature(job)] === true; }
export async function getCrmRolloutFlags(empresaId: string): Promise<CrmRolloutFlags> { try { const { data, error } = await getServiceSupabase().from('zelochat_crm_rollout_flags').select('crm_enabled,campaigns_enabled,automations_enabled').eq('empresa_id', empresaId).maybeSingle(); if (error) throw error; return normalizeCrmRolloutFlags(data); } catch (error) { console.error('[crm-rollout] flags unavailable; failing closed', error instanceof Error ? error.message : 'unknown'); return { ...DEFAULT_CRM_ROLLOUT_FLAGS }; } }
export async function requireCrmFeature(req: Request, feature: CrmFeature): Promise<ActorAccessContext> { const access = await requireActorAccess(req); if (!isCrmFeatureEnabled(await getCrmRolloutFlags(access.empresaId), feature)) throw new CrmFeatureDisabledError(feature); return access; }
export function crmFeatureErrorStatus(error: unknown): number { if (error instanceof AccessControlError) return error.code === 'FORBIDDEN' ? 403 : 401; return error instanceof CrmFeatureDisabledError ? 404 : 400; }
