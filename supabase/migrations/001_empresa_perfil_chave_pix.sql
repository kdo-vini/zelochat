-- Migration: add chave_pix to empresa_perfil
-- Run this in the Supabase SQL Editor for the ZeloPDV project.
--
-- Table: empresa_perfil (shared with zeloPDV)
-- New column: chave_pix — stores the PIX key (CPF, CNPJ, email, phone, or random key)

ALTER TABLE empresa_perfil
  ADD COLUMN IF NOT EXISTS chave_pix text;

COMMENT ON COLUMN empresa_perfil.chave_pix IS
  'Chave PIX da empresa (CPF, CNPJ, e-mail, telefone ou chave aleatória). '
  'Usada pelo ZeloChat para informar clientes no checkout.';
