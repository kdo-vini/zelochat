import { useCallback, useEffect, useState } from 'react';

type Permission = 'default' | 'granted' | 'denied' | 'unsupported';

function readPermission(): Permission {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission as Permission;
}

/**
 * Wraps the browser Notification API with a permission flow + a tab-visibility
 * gate. We only fire system notifications when the operator's tab is hidden OR
 * they're looking at a different conversation — otherwise the in-app red border
 * + sound is enough and a system popup just clutters the screen.
 */
export function useNotifications() {
  const [permission, setPermission] = useState<Permission>(readPermission);
  const [isVisible, setIsVisible] = useState<boolean>(() =>
    typeof document === 'undefined' ? true : document.visibilityState === 'visible',
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisChange = () => setIsVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisChange);
    return () => document.removeEventListener('visibilitychange', onVisChange);
  }, []);

  const requestPermission = useCallback(async (): Promise<Permission> => {
    if (permission === 'unsupported') return 'unsupported';
    if (permission === 'granted' || permission === 'denied') return permission;
    try {
      const next = (await Notification.requestPermission()) as Permission;
      setPermission(next);
      return next;
    } catch {
      return 'denied';
    }
  }, [permission]);

  /**
   * Fire a system notification. Pass `forceShow=true` for high-urgency cases
   * (escalations) where you want to override the visibility check — the tab
   * may be focused but the operator might be looking at a different chat or
   * a different app window over the browser.
   */
  const notify = useCallback(
    (
      title: string,
      body: string,
      opts: { tag?: string; forceShow?: boolean } = {},
    ): void => {
      if (permission !== 'granted') return;
      if (!opts.forceShow && isVisible) return;
      try {
        const n = new Notification(title, {
          body,
          tag: opts.tag,
          icon: '/icon-192.png',
          silent: false,
        });
        n.onclick = () => {
          window.focus();
          n.close();
        };
      } catch {
        // older browsers may throw on bad icon paths; the notification is
        // optional UX, never throw upward.
      }
    },
    [permission, isVisible],
  );

  return { permission, isVisible, requestPermission, notify };
}
