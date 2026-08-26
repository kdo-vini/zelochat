import { Router, type Request, type Response } from 'express';
import { AccessControlError, requireActorPermission, type ActorAccessContext } from '../accessControl.js';
import { crmFeatureErrorStatus, requireCrmFeature } from './rollout.js';
import { getServiceSupabase, uploadMediaForSend } from '../supabase.js';
import { sendTextMessage, sendMediaMessage, sendWhatsAppAudio } from '../whatsapp.js';
import { createAssistantMessageIntent, markAssistantMessageSendFailed, markAssistantMessageSendSucceeded } from '../messageHandler.js';
import { parseCustomerFilters } from './filters.js';
import { getCustomerDetail, listCustomerMessages, listCustomerOrders, listCustomerTimeline, listCustomers } from './service.js';
import { createCustomersRouter, type CustomerMutationAccess, type CustomerWriteStore } from './mutations.js';

export const customerRouter = Router();
async function actor(req: Request): Promise<ActorAccessContext> { await requireCrmFeature(req, 'crm'); return requireActorPermission(req, 'pessoas.visualizar'); }
function sendCustomerReadError(res: Response, cause: unknown): void {
  const code = cause instanceof AccessControlError ? cause.code : 'CUSTOMER_READ_FAILED';
  const status = crmFeatureErrorStatus(cause) !== 400 ? crmFeatureErrorStatus(cause) : (code === 'UNAUTHORIZED' ? 401 : code === 'FORBIDDEN' ? 403 : 400);
  res.status(status).json({ code, message: code === 'FORBIDDEN' ? 'Você não tem permissão para visualizar clientes.' : 'Não foi possível carregar os dados dos clientes.' });
}

customerRouter.get('/api/customers', async (req, res) => { try { const access = await actor(req); res.json(await listCustomers(access.empresaId, access.ownerUserId, parseCustomerFilters(req.query as Record<string, unknown>))); } catch (cause) { sendCustomerReadError(res, cause); } });
customerRouter.get('/api/customers/:personId', async (req, res) => { try { const access = await actor(req); const detail = await getCustomerDetail(access.empresaId, access.ownerUserId, req.params.personId); if (!detail) { res.status(404).json({ code: 'NOT_FOUND', message: 'Cliente não encontrado.' }); return; } res.json(detail); } catch (cause) { sendCustomerReadError(res, cause); } });
customerRouter.get('/api/customers/:personId/messages', async (req, res) => { try { const access = await actor(req); if (!await getCustomerDetail(access.empresaId, access.ownerUserId, req.params.personId)) { res.status(404).json({ code: 'NOT_FOUND', message: 'Cliente não encontrado.' }); return; } res.json(await listCustomerMessages(access.empresaId, req.params.personId, typeof req.query.cursor === 'string' ? req.query.cursor : null, Number(req.query.limit) || 30)); } catch (cause) { sendCustomerReadError(res, cause); } });
customerRouter.get('/api/customers/:personId/orders', async (req, res) => { try { const access = await actor(req); if (!await getCustomerDetail(access.empresaId, access.ownerUserId, req.params.personId)) { res.status(404).json({ code: 'NOT_FOUND', message: 'Cliente não encontrado.' }); return; } res.json(await listCustomerOrders(access.empresaId, req.params.personId, typeof req.query.cursor === 'string' ? req.query.cursor : null, Number(req.query.limit) || 30)); } catch (cause) { sendCustomerReadError(res, cause); } });
customerRouter.get('/api/customers/:personId/timeline', async (req, res) => { try { const access = await actor(req); if (!await getCustomerDetail(access.empresaId, access.ownerUserId, req.params.personId)) { res.status(404).json({ code: 'NOT_FOUND', message: 'Cliente não encontrado.' }); return; } res.json(await listCustomerTimeline(access.empresaId, access.ownerUserId, req.params.personId, typeof req.query.cursor === 'string' ? req.query.cursor : null, Number(req.query.limit) || 30)); } catch (cause) { sendCustomerReadError(res, cause); } });

function mutationAccess(context: ActorAccessContext): CustomerMutationAccess { return { isOwner: context.isOwner, permissions: context.permissions, empresaId: context.empresaId, ownerUserId: context.ownerUserId }; }

async function persistRelationship(empresaId: string, personId: string, patch: Record<string, unknown>): Promise<void> {
  const db = getServiceSupabase();
  const { data: perfil, error: perfilError } = await db.from('empresa_perfil').select('user_id').eq('id', empresaId).maybeSingle();
  if (perfilError || !perfil?.user_id) throw new Error(perfilError?.code ?? 'CUSTOMER_MUTATION_FAILED');
  const relationship: Record<string, unknown> = { empresa_id: empresaId, id_usuario: perfil.user_id, pessoa_id: personId };
  if (typeof patch.notes === 'string') relationship.internal_notes = patch.notes.slice(0, 4000);
  if (typeof patch.whatsappBlocked === 'boolean') relationship.whatsapp_blocked_at = patch.whatsappBlocked ? new Date().toISOString() : null;
  if (Object.keys(relationship).length > 2) {
    const { error } = await getServiceSupabase().from('zelochat_customer_relationships').upsert(relationship, { onConflict: 'empresa_id,pessoa_id' });
    if (error) throw new Error(error.code ?? 'CUSTOMER_MUTATION_FAILED');
  }
  if (Array.isArray(patch.tags)) {
    const names = patch.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean).slice(0, 30);
    const { data: tags, error: tagsError } = await db.from('zelochat_tags').select('id,name').eq('empresa_id', empresaId).in('name', names);
    if (tagsError) throw new Error(tagsError.code ?? 'CUSTOMER_MUTATION_FAILED');
    const { error: clearError } = await db.from('zelochat_person_tags').delete().eq('empresa_id', empresaId).eq('pessoa_id', personId);
    if (clearError) throw new Error(clearError.code ?? 'CUSTOMER_MUTATION_FAILED');
    if (tags?.length) { const { error } = await db.from('zelochat_person_tags').insert(tags.map((tag) => ({ empresa_id: empresaId, id_usuario: perfil.user_id, pessoa_id: personId, tag_id: tag.id }))); if (error) throw new Error(error.code ?? 'CUSTOMER_MUTATION_FAILED'); }
  }
}

const mutationStore: CustomerWriteStore = {
  async getPersonEmpresaId(personId) { const db = getServiceSupabase(); const { data: person, error } = await db.from('pessoas').select('id_usuario,tipo').eq('id', personId).eq('tipo', 'cliente').maybeSingle(); if (error || !person?.id_usuario) return null; const { data: empresa } = await db.from('empresa_perfil').select('id').eq('user_id', person.id_usuario).maybeSingle(); return empresa?.id ?? null; },
  async callRpc(name, args) { const { data, error } = await getServiceSupabase().rpc(name, args); return { data, error }; },
  async createCustomer(empresaId, patch) { const owner = await getServiceSupabase().from('empresa_perfil').select('user_id').eq('id', empresaId).maybeSingle(); if (!owner.data?.user_id) throw new Error('NOT_FOUND'); const phones = Array.isArray(patch.phones) ? patch.phones : []; const birthday = patch.birthday && typeof patch.birthday === 'object' ? patch.birthday as { day?: number; month?: number; year?: number | null } : {}; const { data, error } = await getServiceSupabase().from('pessoas').insert({ id_usuario: owner.data.user_id, tipo: 'cliente', nome: typeof patch.name === 'string' ? patch.name.trim() : '', contato: typeof phones[0] === 'string' ? phones[0] : null, aniversario_dia: birthday.day ?? null, aniversario_mes: birthday.month ?? null, aniversario_ano: birthday.year ?? null }).select('*').single(); if (error) throw new Error(error.code ?? 'CUSTOMER_MUTATION_FAILED'); await persistRelationship(empresaId, data.id, patch); return data; },
  async updateCustomer(personId, empresaId, patch) { if (await this.getPersonEmpresaId(personId) !== empresaId) throw new Error('NOT_FOUND'); const values: Record<string, unknown> = {}; if (typeof patch.name === 'string') values.nome = patch.name.trim(); if (Array.isArray(patch.phones)) values.contato = typeof patch.phones[0] === 'string' ? patch.phones[0] : null; if (patch.birthday === null) { values.aniversario_dia = null; values.aniversario_mes = null; values.aniversario_ano = null; } else if (patch.birthday && typeof patch.birthday === 'object') { const birthday = patch.birthday as { day?: number; month?: number; year?: number | null }; values.aniversario_dia = birthday.day ?? null; values.aniversario_mes = birthday.month ?? null; values.aniversario_ano = birthday.year ?? null; } const { data, error } = await getServiceSupabase().from('pessoas').update(values).eq('id', personId).eq('tipo', 'cliente').select('*').single(); if (error) throw new Error(error.code ?? 'CUSTOMER_MUTATION_FAILED'); await persistRelationship(empresaId, personId, patch); return data; },
  async previewMerge(sourceId, targetId, empresaId) { if (await this.getPersonEmpresaId(sourceId) !== empresaId || await this.getPersonEmpresaId(targetId) !== empresaId) throw new Error('NOT_FOUND'); const db = getServiceSupabase(); const [source, target, sessions, orders] = await Promise.all([db.from('pessoas').select('id,nome,contato').eq('id', sourceId).eq('tipo', 'cliente'), db.from('pessoas').select('id,nome,contato').eq('id', targetId).eq('tipo', 'cliente'), db.from('zelochat_sessions').select('id').eq('empresa_id', empresaId).eq('pessoa_id', sourceId), db.from('zelo_orders').select('id').eq('empresa_id', empresaId).eq('pessoa_id', sourceId)]); if (!source.data?.length || !target.data?.length) throw new Error('NOT_FOUND'); const preview = (person: { id: string; nome: string | null; contato: string | null }) => ({ id: person.id, name: person.nome || 'Cliente', phone: person.contato, whatsapp: person.contato, hasWhatsApp: Boolean(person.contato), lastActivityAt: null, activityState: 'inactive', orderCount: 0, totalOrders: 0, totalValue: 0, openBalance: null, tags: [] }); return { source: preview(source.data[0]), target: preview(target.data[0]), conversations: sessions.data?.length ?? 0, orders: orders.data?.length ?? 0 }; },
  async executeMergeTransaction(sourceId, targetId, empresaId) { if (await this.getPersonEmpresaId(sourceId) !== empresaId || await this.getPersonEmpresaId(targetId) !== empresaId) throw new Error('NOT_FOUND'); const { error } = await getServiceSupabase().rpc('merge_zelochat_customers', { p_source_id: sourceId, p_target_id: targetId, p_empresa_id: empresaId }); if (error) throw new Error(error.code ?? 'CUSTOMER_MUTATION_FAILED'); },
};

const writeRouter = createCustomersRouter({ resolveAccess: async (req) => { await requireCrmFeature(req, 'crm'); return requireActorPermission(req, 'pessoas.gerenciar').then(mutationAccess); }, store: mutationStore, toCanonical: (access, personId) => getCustomerDetail(access.empresaId, access.ownerUserId ?? '', personId) });
customerRouter.use('/api/customers', writeRouter);

customerRouter.post('/api/customers/:personId/messages', async (req, res) => {
  try {
    await requireCrmFeature(req, 'crm');
    const access = await requireActorPermission(req, 'clientes.comunicar');
    const detail = await getCustomerDetail(access.empresaId, access.ownerUserId, req.params.personId);
    const jid = typeof req.body?.primaryJid === 'string' ? req.body.primaryJid : '';
    const session = detail?.sessions.find((item) => item.remoteJid === jid && jid === detail.primaryJid && /^\d{10,15}@s\.whatsapp\.net$/u.test(item.remoteJid));
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const attachment = req.body?.attachment;
    if (!detail || !session || (!message && !attachment)) { res.status(400).json({ code: 'CUSTOMER_SEND_INVALID', message: 'Selecione um WhatsApp válido e informe uma mensagem ou anexo.' }); return; }
    let outboundAttachment = attachment;
    if (attachment?.dataUrl) outboundAttachment = { ...attachment, dataUrl: await uploadMediaForSend(attachment.dataUrl, attachment.fileName, attachment.mimeType, access.empresaId) };
    const intent = await createAssistantMessageIntent(jid, message, access.empresaId, outboundAttachment);
    try {
      const waId = outboundAttachment?.dataUrl
        ? outboundAttachment.type === 'audio' ? await sendWhatsAppAudio(jid, outboundAttachment.dataUrl, access.empresaId) : await sendMediaMessage(jid, { mediatype: outboundAttachment.type === 'image' ? 'image' : outboundAttachment.type === 'video' ? 'video' : 'document', mimetype: outboundAttachment.mimeType, media: outboundAttachment.dataUrl, caption: message || undefined, fileName: outboundAttachment.fileName }, access.empresaId)
        : await sendTextMessage(jid, message, access.empresaId);
      await markAssistantMessageSendSucceeded(access.empresaId, intent.id, waId ?? null);
      res.json({ ok: true, dbMessageId: intent.id, messageId: waId ?? null, status: 'sent' });
    } catch {
      await markAssistantMessageSendFailed(access.empresaId, intent.id, 'Falha ao enviar a mensagem.').catch(() => undefined);
      res.status(502).json({ code: 'CUSTOMER_SEND_FAILED', message: 'Não foi possível enviar a mensagem. Tente novamente.' , dbMessageId: intent.id, status: 'failed' });
    }
  } catch (error) { const code = error instanceof Error ? error.message : 'CUSTOMER_SEND_FAILED'; const status = crmFeatureErrorStatus(error) !== 400 ? crmFeatureErrorStatus(error) : (code === 'FORBIDDEN' ? 403 : 400); res.status(status).json({ code, message: code === 'FORBIDDEN' ? 'Você não tem permissão para enviar mensagens.' : 'Não foi possível enviar a mensagem.' }); }
});
