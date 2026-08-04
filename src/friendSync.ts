import * as SecureStore from 'expo-secure-store';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://lkgipsszgvpcabdefvhc.supabase.co';
const functionUrl = `${supabaseUrl}/functions/v1/friend-sync`;
const SESSION_KEY = 'ootique.friend-session.v1';

export type FriendSession = {
  pairId: string;
  memberToken: string;
  slot: 1 | 2;
  inviteCode?: string;
  status: 'waiting' | 'pending' | 'active';
};

export type FriendState = {
  pairId: string;
  slot: 1 | 2;
  status: 'waiting' | 'pending' | 'active' | 'closed';
  pendingJoin?: boolean;
  photos: { slot: 1 | 2; version: number; available: boolean }[];
};

export const friendSyncConfigured = Boolean(functionUrl);

async function request<T>(action: string, session?: FriendSession, init: RequestInit = {}) {
  if (!friendSyncConfigured) throw new Error('not_configured');
  const response = await fetch(`${functionUrl}?action=${action}`, {
    ...init,
    headers: {
      ...(session ? { Authorization: `Bearer ${session.memberToken}` } : {}),
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'request_failed');
  return body as T;
}

export async function loadFriendSession() {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as FriendSession; } catch { await SecureStore.deleteItemAsync(SESSION_KEY); return null; }
}

export async function saveFriendSession(session: FriendSession) {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return session;
}

export async function createFriendPair() {
  const session = await request<FriendSession>('create', undefined, { method: 'POST' });
  return saveFriendSession(session);
}

export async function joinFriendPair(inviteCode: string) {
  const joined = await request<FriendSession>('join', undefined, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inviteCode }),
  });
  const session = { ...joined, inviteCode };
  return saveFriendSession(session);
}

export async function getFriendState(session: FriendSession) {
  return request<FriendState>('state', session, { method: 'GET' });
}

export async function approveFriendJoin(session: FriendSession) {
  await request<{ status: 'active' }>('approve', session, { method: 'POST' });
  return saveFriendSession({ ...session, status: 'active' });
}

export async function uploadOwnFriendPhoto(session: FriendSession, uri: string, expectedVersion: number) {
  const form = new FormData();
  form.append('expectedVersion', String(expectedVersion));
  form.append('file', { uri, type: 'image/jpeg', name: 'ootd.jpg' } as unknown as Blob);
  return request<{ version: number }>('upload', session, { method: 'POST', body: form });
}

export function friendPhotoSource(session: FriendSession, slot: 1 | 2, version: number) {
  return {
    uri: `${functionUrl}?action=photo&slot=${slot}&v=${version}`,
    headers: { Authorization: `Bearer ${session.memberToken}` },
  };
}
