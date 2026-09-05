-- Disposable outbound fixture. Support CREATE TABLE/PK clauses copied verbatim from
-- kdo-vini/zelopdv supabase/baselines/20260813091000/schema.sql.
-- Only platform identity + six prerequisite tables. No business RPC is stubbed.
-- CRM/outbound tables and ALL functions under test come from original migrations.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key);
grant usage on schema public, auth to anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS "public"."empresa_perfil" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "nome_exibicao" "text" NOT NULL,
    "documento" "text",
    "inscricao_estadual" "text",
    "endereco" "text",
    "contato" "text",
    "timezone" "text" DEFAULT 'America/Sao_Paulo'::"text",
    "logo_url" "text",
    "rodape_recibo" "text" DEFAULT 'Obrigado pela preferência!'::"text",
    "largura_bobina" "text" DEFAULT '80mm'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "modulo_pdv_ativo" boolean DEFAULT true NOT NULL,
    "modulo_delivery_ativo" boolean DEFAULT false NOT NULL,
    "pin_admin" "text",
    "razao_social" "text",
    "plataformas_pagamento" "jsonb" DEFAULT '[]'::"jsonb",
    "last_seen_at" timestamp with time zone,
    "onboarding_completed" boolean DEFAULT false,
    "chave_pix" "text",
    "manager_phone" "text",
    "horario_abertura" "text",
    "horario_fechamento" "text",
    "dias_fechamento" "text"[] DEFAULT '{}'::"text"[],
    "ai_instructions" "text",
    "blocked_dates" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "manager_history" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "tipo_negocio" "text",
    "zelochat_onboarding_done" boolean DEFAULT false NOT NULL,
    "ai_enabled" boolean DEFAULT true NOT NULL,
    "webhook_token" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "ai_can_reengage_pending" boolean DEFAULT false NOT NULL,
    "zelochat_disabled_builtin_triggers" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "delivery_config" "jsonb",
    "whatsmiau_instance" "text",
    "whatsmiau_connected" boolean DEFAULT false NOT NULL,
    "whatsmiau_phone" "text",
    "notify_customer_preparing" boolean DEFAULT true NOT NULL,
    "notify_customer_ready" boolean DEFAULT true NOT NULL,
    "notify_customer_out_for_delivery" boolean DEFAULT true NOT NULL,
    "pix_receipt_config" "jsonb",
    "ai_mode" "text" DEFAULT 'always_on'::"text" NOT NULL,
    "ai_schedule_start" "text",
    "ai_schedule_end" "text",
    "zelochat_mode" "text" DEFAULT 'restaurant'::"text" NOT NULL,
    "zelochat_internal_send_key_hash" "text",
    "zelochat_onboarding_done_at" timestamp with time zone,
    "tabelas_preco_ativo" boolean DEFAULT false NOT NULL,
    "tabela_preco_1_nome" "text" DEFAULT 'Tabela 1'::"text" NOT NULL,
    "tabela_preco_2_nome" "text" DEFAULT 'Tabela 2'::"text" NOT NULL,
    "tabela_preco_3_nome" "text" DEFAULT 'Tabela 3'::"text" NOT NULL,
    "referral_code" "text",
    "deletion_scheduled_at" timestamp with time zone,
    "deletion_requested_at" timestamp with time zone,
    "deletion_source" "text",
    "ai_schedule_days" "jsonb",
    "zelomenu_slug" "text",
    "zelomenu_welcome_text" "text",
    "zelomenu_featured_enabled" boolean DEFAULT false NOT NULL,
    "zelomenu_featured_product_ids" "jsonb",
    "zelomenu_category_order" "jsonb",
    "intelligence_enabled_at" timestamp with time zone,
    "gerente_prefs" "jsonb" DEFAULT '{"whatsapp": {"hora": "07", "enabled": false}, "muted_types": []}'::"jsonb" NOT NULL,
    "gerente_whatsapp_last_sent_date" "date",
    "horario_semanal" "jsonb",
    "zelomenu_recommendations_enabled" boolean DEFAULT false NOT NULL,
    "zelomenu_recommendation_product_ids" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "zelomenu_category_suggestions" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "zelomenu_pix_key_type" "text",
    "zelomenu_auto_accept_orders" boolean DEFAULT false NOT NULL,
    "delivery_postal_code" "text",
    "delivery_number" "text",
    "delivery_complement" "text",
    "delivery_street" "text",
    "delivery_neighborhood" "text",
    "delivery_city" "text",
    "delivery_state" "text",
    "delivery_latitude" double precision,
    "delivery_longitude" double precision,
    "delivery_location_version" bigint DEFAULT 0 NOT NULL,
    "zelomenu_cover_url" "text",
    "zelomenu_description" "text",
    "zelomenu_sponsored_enabled" boolean DEFAULT false NOT NULL,
    "origem_aquisicao" "jsonb",
    "zelomenu_scheduling_enabled" boolean DEFAULT true NOT NULL,
    "zelomenu_scheduling_lead_time_minutes" integer DEFAULT 60 NOT NULL,
    CONSTRAINT "empresa_perfil_gerente_prefs_object_check" CHECK (("jsonb_typeof"("gerente_prefs") = 'object'::"text")),
    CONSTRAINT "empresa_perfil_zelochat_mode_check" CHECK (("zelochat_mode" = ANY (ARRAY['restaurant'::"text", 'general'::"text"]))),
    CONSTRAINT "zelomenu_scheduling_lead_time_check" CHECK (("zelomenu_scheduling_lead_time_minutes" >= 0))
);
ALTER TABLE ONLY "public"."empresa_perfil"
    ADD CONSTRAINT "empresa_perfil_pkey" PRIMARY KEY ("id");

CREATE TABLE IF NOT EXISTS "public"."access_users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    "auth_user_id" "uuid",
    "email" "text" NOT NULL,
    "role_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "access_users_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'active'::"text", 'blocked'::"text", 'removed'::"text"])))
);
ALTER TABLE ONLY "public"."access_users"
    ADD CONSTRAINT "access_users_pkey" PRIMARY KEY ("id");

CREATE TABLE IF NOT EXISTS "public"."zelochat_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" NOT NULL,
    "remote_jid" "text" NOT NULL,
    "customer_name" "text",
    "customer_phone" "text",
    "last_message" "text",
    "last_message_time" "text",
    "unread_count" integer DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "auto_reply" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "profile_pic_url" "text",
    "escalated_at" timestamp with time zone,
    "acknowledged_at" timestamp with time zone,
    "pinned" boolean DEFAULT false NOT NULL,
    "customer_profile" "text",
    CONSTRAINT "zelochat_sessions_customer_profile_check" CHECK ((("customer_profile" IS NULL) OR ("length"("customer_profile") <= 600))),
    CONSTRAINT "zelochat_sessions_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'escalated'::"text", 'resolved'::"text", 'archived'::"text"])))
);
ALTER TABLE ONLY "public"."zelochat_sessions"
    ADD CONSTRAINT "zelochat_sessions_pkey" PRIMARY KEY ("id");

CREATE TABLE IF NOT EXISTS "public"."zelochat_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" NOT NULL,
    "session_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "content" "text",
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "tool_calls" "jsonb",
    "tool_call_id" "text",
    "audio_transcript" "text",
    "audio_transcript_status" "text",
    "wa_message_id" "text",
    "reactions" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "quoted_wa_id" "text",
    "quoted_from_me" boolean,
    "quoted_preview" "text",
    "outbound_status" "text",
    "outbound_error" "text",
    "audio_transcript_error" "text",
    CONSTRAINT "zelochat_messages_audio_transcript_status_check" CHECK (("audio_transcript_status" = ANY (ARRAY['pending'::"text", 'done'::"text", 'failed'::"text"]))),
    CONSTRAINT "zelochat_messages_outbound_status_check" CHECK ((("outbound_status" IS NULL) OR ("outbound_status" = ANY (ARRAY['queued'::"text", 'sending'::"text", 'sent'::"text", 'failed'::"text"])))),
    CONSTRAINT "zelochat_messages_role_check" CHECK (("role" = ANY (ARRAY['user'::"text", 'assistant'::"text", 'tool'::"text", 'system'::"text"])))
);
ALTER TABLE ONLY "public"."zelochat_messages"
    ADD CONSTRAINT "zelochat_messages_pkey" PRIMARY KEY ("id");

CREATE TABLE IF NOT EXISTS "public"."zelochat_pending_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "empresa_id" "uuid" NOT NULL,
    "remote_jid" "text" NOT NULL,
    "customer_name" "text" NOT NULL,
    "customer_phone" "text",
    "items" "jsonb" NOT NULL,
    "pickup_date" "date" NOT NULL,
    "pickup_time" "text" NOT NULL,
    "payment_method" "text",
    "total" numeric(10,2) NOT NULL,
    "tool_call_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '00:30:00'::interval) NOT NULL,
    "order_type" "text",
    "delivery_address" "text",
    "delivery_neighborhood" "text",
    "delivery_fee" numeric(10,2),
    "observations" "text",
    "pix_receipt_status" "text" DEFAULT 'not_required'::"text" NOT NULL,
    "pix_receipt_message_id" "text",
    "pix_receipt_analysis" "jsonb",
    "pix_receipt_rejection_reason" "text",
    CONSTRAINT "zelochat_pending_orders_observations_length_chk" CHECK ((("observations" IS NULL) OR ("length"("observations") <= 500))),
    CONSTRAINT "zelochat_pending_orders_order_type_check" CHECK (("order_type" = ANY (ARRAY['pickup'::"text", 'delivery'::"text"]))),
    CONSTRAINT "zelochat_pending_orders_pix_receipt_status_chk" CHECK (("pix_receipt_status" = ANY (ARRAY['not_required'::"text", 'required'::"text", 'approved'::"text", 'rejected'::"text"])))
);
ALTER TABLE ONLY "public"."zelochat_pending_orders"
    ADD CONSTRAINT "zelochat_pending_orders_pkey" PRIMARY KEY ("id");

CREATE TABLE IF NOT EXISTS "public"."zelochat_webhook_events_raw" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "instance" "text" NOT NULL,
    "empresa_id" "uuid",
    "event_type" "text",
    "wa_message_id" "text",
    "payload" "jsonb" NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processed_at" timestamp with time zone,
    "processing_error" "text",
    "auth_status" "text"
);
ALTER TABLE ONLY "public"."zelochat_webhook_events_raw"
    ADD CONSTRAINT "zelochat_webhook_events_raw_pkey" PRIMARY KEY ("id");

-- DDL prerequisites from migration 048_customer_relationship_foundation.sql.
alter table public.empresa_perfil add constraint empresa_perfil_id_user_id_key unique (id, user_id);
alter table public.zelochat_sessions
  add column if not exists pessoa_id uuid,
  add column if not exists owner_user_id uuid;

grant all on all tables in schema public to service_role;
