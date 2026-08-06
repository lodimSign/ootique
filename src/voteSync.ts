import * as SecureStore from 'expo-secure-store';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://lkgipsszgvpcabdefvhc.supabase.co';
const functionUrl = `${supabaseUrl}/functions/v1/vote`;
const DEVICE_KEY = 'ootique.vote-device.v1';

export type PublishResult = { entryId: string; shareToken: string; matchShareToken: string | null };

// 투표 페이지는 GitHub Pages에 있다. Supabase Edge Function은 HTML을 돌려줄 수 없다 —
// 게이트웨이가 text/plain과 `CSP: default-src 'none'; sandbox`를 강제로 붙인다(2026-08-06 실측).
const votePageUrl = 'https://lodimsign.github.io/ootique/v.html';

// 링크를 받은 사람은 앱이 없어도 이 주소에서 투표하고 앱을 받을 수 있다.
export function voteLink(token: string): string {
  return `${votePageUrl}?t=${encodeURIComponent(token)}`;
}

export function shareMessage(colorName: string, token: string): string {
  return `오늘의 컬러는 ${colorName}. 어느 쪽이 더 잘 살렸는지 골라주세요.\n${voteLink(token)}`;
}

async function deviceToken(): Promise<string> {
  const stored = await SecureStore.getItemAsync(DEVICE_KEY);
  if (stored) return stored;
  const response = await fetch(`${functionUrl}?action=register`, { method: 'POST' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.deviceToken !== 'string') {
    throw new Error(typeof body.error === 'string' ? body.error : 'register_failed');
  }
  await SecureStore.setItemAsync(DEVICE_KEY, body.deviceToken, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return body.deviceToken;
}

export async function publishEntry(input: {
  photoUri: string;
  thumbUri: string;
  colorId: string;
  pairId?: string;
  slot?: 1 | 2;
}): Promise<PublishResult> {
  const token = await deviceToken();
  const form = new FormData();
  form.append('colorId', input.colorId);
  form.append('photo', { uri: input.photoUri, type: 'image/jpeg', name: 'full.jpg' } as unknown as Blob);
  form.append('thumb', { uri: input.thumbUri, type: 'image/jpeg', name: 'thumb.jpg' } as unknown as Blob);
  if (input.pairId && input.slot) {
    form.append('pairId', input.pairId);
    form.append('slot', String(input.slot));
  }
  const response = await fetch(`${functionUrl}?action=publish`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'publish_failed');
  return body as PublishResult;
}

export async function unpublishEntry(entryId: string): Promise<void> {
  const token = await deviceToken();
  const response = await fetch(`${functionUrl}?action=unpublish`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ entryId }),
  });
  if (!response.ok) throw new Error('unpublish_failed');
}

// 먼저 공개한 사람은 대결 링크가 아직 없다. 상대가 공개하면 그때 생기므로 공유 직전에 다시 묻는다.
export async function currentShareToken(entryShareToken: string): Promise<string> {
  const response = await fetch(`${functionUrl}?action=link&t=${encodeURIComponent(entryShareToken)}`);
  const body = await response.json().catch(() => ({}));
  return response.ok && typeof body.shareToken === 'string' ? body.shareToken : entryShareToken;
}
