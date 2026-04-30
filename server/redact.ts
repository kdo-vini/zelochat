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

/**
 * Redact a customer email address for LGPD-compliant logging.
 * `someone@example.com` → `so***@***.com`
 * Keeps the first 2 chars of the local-part and the TLD of the domain.
 */
export function redactEmail(email: string | null | undefined): string {
  if (!email) return '<no-email>';
  const atIdx = email.indexOf('@');
  if (atIdx < 0) return '***';
  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx + 1);
  const redactedLocal = local.length > 2 ? `${local.slice(0, 2)}***` : '***';
  // Keep only the TLD portion: last segment after the final dot
  const lastDot = domain.lastIndexOf('.');
  const tld = lastDot >= 0 ? domain.slice(lastDot) : '';
  return `${redactedLocal}@***${tld}`;
}

/**
 * Redact a Stripe customer ID for LGPD-compliant logging.
 * `cus_1A2B3C4D5E6F` → `cus_***6F`  (keeps prefix type + last 4 chars)
 */
export function redactCustomerId(id: string | null | undefined): string {
  if (!id) return '<no-customer>';
  const underscoreIdx = id.indexOf('_');
  if (underscoreIdx < 0) return `***${id.slice(-4)}`;
  const prefix = id.slice(0, underscoreIdx + 1); // e.g. "cus_"
  const rest = id.slice(underscoreIdx + 1);
  const tail = rest.length > 4 ? rest.slice(-4) : rest;
  return `${prefix}***${tail}`;
}
