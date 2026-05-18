import { useCallback, useState } from 'react';
import { PaywallModal } from '@/components/PaywallModal';
import { useAuth } from '@/hooks/useAuth';
import { hasProAccess } from '@/lib/plans';

export function usePaywall() {
  const { user } = useAuth();
  const isPro = hasProAccess(user);
  const [visible, setVisible] = useState(false);

  const openPaywall = useCallback(() => setVisible(true), []);
  const closePaywall = useCallback(() => setVisible(false), []);

  /** Returns true if allowed; opens paywall and returns false when gated. */
  const requirePro = useCallback(
    (onAllowed?: () => void) => {
      if (isPro) {
        onAllowed?.();
        return true;
      }
      setVisible(true);
      return false;
    },
    [isPro],
  );

  const Paywall = useCallback(
    () => <PaywallModal visible={visible} onClose={closePaywall} />,
    [visible, closePaywall],
  );

  return {
    isPro,
    requirePro,
    openPaywall,
    closePaywall,
    paywallVisible: visible,
    Paywall,
  };
}
