-- Web Push subscriptions per empresa.
-- One row per browser/device that opted in to push notifications.
-- The (empresa_id, endpoint) pair is unique: re-subscribing from the
-- same browser is an upsert, not a duplicate.

CREATE TABLE zelochat_push_subscriptions (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  empresa_id    uuid NOT NULL REFERENCES empresa_perfil(id) ON DELETE CASCADE,
  endpoint      text NOT NULL,
  p256dh        text NOT NULL,
  auth          text NOT NULL,
  user_agent    text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  last_seen_at  timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX zelochat_push_subscriptions_empresa_endpoint
  ON zelochat_push_subscriptions(empresa_id, endpoint);
CREATE INDEX zelochat_push_subscriptions_empresa_id
  ON zelochat_push_subscriptions(empresa_id);

ALTER TABLE zelochat_push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "zelochat_push_subscriptions_empresa_owner"
  ON zelochat_push_subscriptions
  USING (empresa_id = (SELECT id FROM empresa_perfil WHERE user_id = auth.uid()))
  WITH CHECK (empresa_id = (SELECT id FROM empresa_perfil WHERE user_id = auth.uid()));
