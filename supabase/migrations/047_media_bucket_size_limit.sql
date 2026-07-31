-- 047 — Alinha o limite de tamanho do bucket zelochat-media com o cap do servidor.
--
-- server/messageHandler.ts aceita até 25MB de mídia inbound (MAX_INBOUND_MEDIA_BYTES),
-- mas o bucket criado na migration 000 permitia apenas 10MB. O resultado era que PDFs
-- e vídeos entre 10MB e 25MB passavam no servidor, falhavam no upload do Supabase
-- Storage e caíam no fallback de data URI (ou ficavam "Arquivo indisponível").
--
-- 26214400 = 25 * 1024 * 1024. PDFs são o caso de uso mais comum (comprovantes, cardápios).

UPDATE storage.buckets
SET file_size_limit = 26214400
WHERE name = 'zelochat-media';
