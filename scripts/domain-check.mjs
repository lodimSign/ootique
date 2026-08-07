import assert from 'node:assert/strict';

import {
  OOTIQUE_COLORS,
  colorForChallenge,
  createFriendCode,
  freeRetentionCutoffKey,
  friendSessionMatchesCode,
  isRecordWithinFreeRetention,
  localDateKey,
  normalizeFriendCode,
  recordId,
  uploadResizeTarget,
} from '../src/domain.ts';
import { PLUS_PRODUCT_ID, hasPlusPurchase, purchaseErrorMessage } from '../src/purchases.ts';

assert.equal(localDateKey(new Date(2026, 7, 3, 12)), '2026-08-03');
assert.equal(freeRetentionCutoffKey(new Date(2026, 7, 3, 12)), '2026-07-28');
assert.equal(isRecordWithinFreeRetention({ dateKey: '2026-07-28' }, '2026-07-28'), true);
assert.equal(isRecordWithinFreeRetention({ dateKey: '2026-07-27' }, '2026-07-28'), false);
assert.equal(normalizeFriendCode(' ab-12cd! '), 'AB12CD');
assert.equal(friendSessionMatchesCode('ab-23cd', 'AB23CD'), true);
assert.equal(friendSessionMatchesCode('AB23CD', 'EF45GH'), false);
assert.equal(friendSessionMatchesCode(undefined, ''), false);
assert.equal(createFriendCode(123, () => 0.5).length, 6);
assert.equal(recordId('2026-08-03', 'solo'), '2026-08-03-solo-solo');
assert.equal(recordId('2026-08-03', 'friend', 'ab-12cd'), '2026-08-03-friend-AB12CD');

assert.equal(uploadResizeTarget(1200, 900), null);
assert.deepEqual(uploadResizeTarget(4032, 3024), { width: 1600 });
assert.deepEqual(uploadResizeTarget(3024, 4032), { height: 1600 });
assert.deepEqual(uploadResizeTarget(8160, 6120), { width: 1600 });
assert.equal(uploadResizeTarget(8000, 1000), null);

const first = colorForChallenge('2026-08-03', 'friend', 'ab12cd');
const second = colorForChallenge('2026-08-03', 'friend', 'AB12CD');
assert.deepEqual(first, second);
assert.ok(OOTIQUE_COLORS.some((color) => color.id === first.id));

assert.equal(PLUS_PRODUCT_ID, 'com.lodim.ootique.plus');
assert.equal(
  hasPlusPurchase([{ productId: PLUS_PRODUCT_ID, purchaseState: 'purchased' }]),
  true,
);
assert.equal(
  hasPlusPurchase([{ productId: PLUS_PRODUCT_ID, purchaseState: 'pending' }]),
  false,
);
assert.equal(purchaseErrorMessage('user-cancelled'), null);
// i18n 도입 후 문구는 실행 기기 언어를 따른다 — 언어별 원문 비교 대신 두 언어 중 하나인지 본다.
assert.match(purchaseErrorMessage('pending'), /기다리고|awaiting approval/);

console.log('domain-check: ok');
