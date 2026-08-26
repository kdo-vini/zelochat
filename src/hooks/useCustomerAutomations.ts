import { useCallback, useEffect, useState } from 'react';
import { AUTOMATION_KINDS, fetchCustomerAutomationHistory, fetchCustomerAutomations, getDefaultAutomationRule, sendCustomerAutomationTest, setCustomerAutomationStatus, updateCustomerAutomation, type AutomationDispatch, type AutomationKind, type AutomationRule } from '../services/customerAutomationApi';

export function useCustomerAutomations(token: string | null) {
  const [rules, setRules] = useState<AutomationRule[]>(() => AUTOMATION_KINDS.map(getDefaultAutomationRule));
  const [history, setHistory] = useState<Record<string, AutomationDispatch[]>>({});
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try { setRules(await fetchCustomerAutomations(token)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as automações.'); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = useCallback(async (rule: AutomationRule) => {
    if (!token) return;
    const updated = await updateCustomerAutomation(token, rule);
    setRules((current) => current.map((item) => item.kind === updated.kind ? updated : item));
  }, [token]);

  const setEnabled = useCallback(async (kind: AutomationKind, enabled: boolean) => {
    if (!token) return;
    const updated = await setCustomerAutomationStatus(token, kind, enabled);
    setRules((current) => current.map((item) => item.kind === updated.kind ? updated : item));
  }, [token]);

  const sendTest = useCallback(async (kind: AutomationKind, phone: string) => {
    if (!token) return;
    await sendCustomerAutomationTest(token, kind, phone);
  }, [token]);

  const loadHistory = useCallback(async (kind: AutomationKind) => {
    if (!token) return [];
    const items = await fetchCustomerAutomationHistory(token, kind);
    setHistory((current) => ({ ...current, [kind]: items }));
    return items;
  }, [token]);

  return { rules, history, loading, error, refresh, save, setEnabled, sendTest, loadHistory };
}
