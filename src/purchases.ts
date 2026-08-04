import type { Purchase } from 'expo-iap';

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
    return '결제 승인을 기다리고 있어요. 승인되면 다시 확인해 주세요.';
  }
  if (code === 'already-owned') {
    return '이미 구매한 상품이에요. 구매 복원을 눌러 주세요.';
  }
  if (code === 'network-error' || code === 'service-timeout') {
    return '스토어 연결이 불안정해요. 잠시 후 다시 시도해 주세요.';
  }
  return '구매를 완료하지 못했어요. 잠시 후 다시 시도해 주세요.';
}
