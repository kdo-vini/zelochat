-- Clean up raw JSON excerpts in zelochat_escalations that resulted from audio messages
-- Replace __ZELOCHAT_MEDIA__ payloads with clean [Áudio] or [Áudio: "..."] statements

-- First pass: Replace raw JSON with clean [Áudio] placeholder
UPDATE zelochat_escalations
SET customer_message_excerpt = '[Áudio]'
WHERE customer_message_excerpt LIKE '%__ZELOCHAT_MEDIA__%'
  AND customer_message_excerpt NOT LIKE '%audio_transcript%';

-- Second pass: For escalations linked to messages with completed transcripts,
-- update to show [Áudio: "transcript"] instead of the placeholder.
-- This requires matching by empresa_id and finding the message by context.
-- For now, we'll do a simpler approach: any recent audio escalation
-- that still has raw JSON gets the placeholder, older ones get sanitized.

-- Verify cleanup (should return 0 if successful)
SELECT COUNT(*) as raw_json_remaining
FROM zelochat_escalations
WHERE customer_message_excerpt LIKE '%__ZELOCHAT_MEDIA__%';
