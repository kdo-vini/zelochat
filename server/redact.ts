/**
 * Log redaction helpers — closes P1.4.
 *
 * Instance names were previously the auth boundary for inbound webhooks
 * (the "instance name is the secret" model). After P0.1 shipped the apikey
 * webhook_token header, instance names are no longer the only secret —
 * but logs that leak them still narrow an attacker's search space and
 * confirm tenant existence. Defense-in-depth: keep them out of plaintext
 * logs.
 *
 * Pattern: keep enough suffix for ops to correlate across log lines without
 * disclosing the full identifier. The empresa UUID is logged separately
 * when present, so an operator with both the redacted instance and a UUID
 * can fully reconstruct context via DB.
 */

/**
 * Redact a Whatsmiau instance name for logs.
 * `zelo-70ec4c72` → `zelo-***4c72`
 * `Comercial_d3c6ca80` → `Com***ca80`
 * Empty/null → `<unknown>`
 */
export function redactInstance(name: string | null | undefined): string {
  if (!name) return '<unknown>';
  if (name.length <= 4) return '***';
  const tail = name.slice(-4);
  // Preserve up to 5 leading chars so the prefix family (zelo-, Comercial_)
  // is still recognizable; mask the middle.
  const head = name.slice(0, Math.min(5, Math.max(0, name.length - 8)));
  return `${head}***${tail}`;
}

/**
 * Redact an opaque secret-ish token for logs.
 * Keeps last 4 chars only.
 */
export function redactToken(token: string | null | undefined): string {
  if (!token) return '<empty>';
  if (token.length <= 4) return '***';
  return `***${token.slice(-4)}`;
}
