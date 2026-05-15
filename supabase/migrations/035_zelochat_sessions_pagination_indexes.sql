-- Support the paginated/filterable inbox API.

CREATE INDEX IF NOT EXISTS idx_zelochat_sessions_inbox_page
  ON public.zelochat_sessions (empresa_id, pinned DESC, last_message_time DESC, updated_at DESC)
  WHERE remote_jid LIKE '%@s.whatsapp.net';

CREATE INDEX IF NOT EXISTS idx_zelochat_sessions_inbox_status_page
  ON public.zelochat_sessions (empresa_id, status, pinned DESC, last_message_time DESC, updated_at DESC)
  WHERE remote_jid LIKE '%@s.whatsapp.net';

CREATE INDEX IF NOT EXISTS idx_zelochat_sessions_inbox_unread_page
  ON public.zelochat_sessions (empresa_id, pinned DESC, last_message_time DESC, updated_at DESC)
  WHERE unread_count > 0 AND status <> 'archived' AND remote_jid LIKE '%@s.whatsapp.net';

CREATE INDEX IF NOT EXISTS idx_zelochat_session_tags_empresa_tag_session
  ON public.zelochat_session_tags (empresa_id, tag_id, session_id);
