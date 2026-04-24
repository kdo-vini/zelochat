/**
 * useSupabaseSession — thin shim over AuthContext.
 * Preserved as a separate hook so existing server-facing hooks
 * (useWhatsAppSessions, useOrders, etc.) keep working unchanged.
 * There is exactly one supabase.auth subscription in the app — inside AuthContext.
 */
import { useAuth } from '../contexts/AuthContext';

export function useSupabaseSession() {
  const { session, token, loading } = useAuth();
  return { session, token, loading };
}
