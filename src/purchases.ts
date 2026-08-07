import type { Purchase } from 'expo-iap';

import { t } from './i18n.ts';

export const PLUS_PRODUCT_ID = 'com.lodim.ootique.plus';

export function hasPlusPurchase(
  purchases: Pick<Purchase, 'productId' | 'purchaseState'>[],
): boolean {
  return purchases.some(
    (purchase) =>
      purchase.productId === PLUS_PRODUCT_ID && purchase.purchaseState === 'purchased',
  );
}

export function purchaseErrorMessage(code: string): string | null {
  if (code === 'user-cancelled') return null;
  if (code === 'pending' || code === 'deferred-payment') {
    return t('purchase.pending');
  }
  if (code === 'already-owned') {
    return t('purchase.alreadyOwned');
  }
  if (code === 'network-error' || code === 'service-timeout') {
    return t('purchase.networkError');
  }
  return t('purchase.unknown');
}
