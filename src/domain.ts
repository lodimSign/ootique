import { t } from './i18n.ts';

export type ChallengeMode = 'solo' | 'friend';

export type Screen = 'today' | 'capture' | 'share' | 'history';

export type OotiqueColor = {
  id: string;
  name: string;
  hex: string;
  mood: string;
};

export type OotdRecord = {
  id: string;
  dateKey: string;
  mode: ChallengeMode;
  friendCode?: string;
  colorId: string;
  photoUri: string;
  partnerPhotoUri?: string;
  createdAt: string;
  // 공개 투표에 참가한 기록만 아래 둘을 갖는다. 기본값은 비공개라 대개 없다.
  publicEntryId?: string;
  shareToken?: string;
};

export const OOTIQUE_COLORS: readonly OotiqueColor[] = [
  { id: 'butter-yellow', name: t('color.butter-yellow'), hex: '#F6D86B', mood: t('mood.butter-yellow') },
  { id: 'tomato-red', name: t('color.tomato-red'), hex: '#D95D4F', mood: t('mood.tomato-red') },
  { id: 'denim-blue', name: t('color.denim-blue'), hex: '#4F7196', mood: t('mood.denim-blue') },
  { id: 'sage-green', name: t('color.sage-green'), hex: '#93A98C', mood: t('mood.sage-green') },
  { id: 'lilac', name: t('color.lilac'), hex: '#B7A3D6', mood: t('mood.lilac') },
  { id: 'peach', name: t('color.peach'), hex: '#F2B184', mood: t('mood.peach') },
  { id: 'coral', name: t('color.coral'), hex: '#ED8178', mood: t('mood.coral') },
  { id: 'sky-blue', name: t('color.sky-blue'), hex: '#9EC4E5', mood: t('mood.sky-blue') },
  { id: 'cream', name: t('color.cream'), hex: '#EEDDBA', mood: t('mood.cream') },
  { id: 'chocolate', name: t('color.chocolate'), hex: '#765044', mood: t('mood.chocolate') },
  { id: 'charcoal', name: t('color.charcoal'), hex: '#45464B', mood: t('mood.charcoal') },
  { id: 'olive', name: t('color.olive'), hex: '#7C824F', mood: t('mood.olive') },
  { id: 'rose-pink', name: t('color.rose-pink'), hex: '#D889A2', mood: t('mood.rose-pink') },
  { id: 'cobalt', name: t('color.cobalt'), hex: '#315EB5', mood: t('mood.cobalt') },
  { id: 'mint', name: t('color.mint'), hex: '#8FC9B8', mood: t('mood.mint') },
  { id: 'burgundy', name: t('color.burgundy'), hex: '#7A3344', mood: t('mood.burgundy') },
  { id: 'apricot', name: t('color.apricot'), hex: '#EAA26E', mood: t('mood.apricot') },
  { id: 'silver-gray', name: t('color.silver-gray'), hex: '#A7A9AE', mood: t('mood.silver-gray') },
] as const;

export function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function freeRetentionCutoffKey(today = new Date()): string {
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - 6);
  return localDateKey(cutoff);
}

export function isRecordWithinFreeRetention(record: Pick<OotdRecord, 'dateKey'>, cutoffKey: string): boolean {
  return record.dateKey >= cutoffKey;
}

export function normalizeFriendCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export function friendSessionMatchesCode(inviteCode: string | undefined, value: string): boolean {
  const normalizedInviteCode = normalizeFriendCode(inviteCode ?? '');
  const normalizedValue = normalizeFriendCode(value);
  return normalizedValue.length === 6 && normalizedInviteCode === normalizedValue;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function colorForChallenge(
  dateKey: string,
  mode: ChallengeMode,
  friendCode = '',
): OotiqueColor {
  const normalizedCode = normalizeFriendCode(friendCode);
  const seed = mode === 'friend' ? `${dateKey}:friend:${normalizedCode}` : `${dateKey}:ootique-daily`;
  return OOTIQUE_COLORS[stableHash(seed) % OOTIQUE_COLORS.length];
}

export function colorById(colorId: string): OotiqueColor {
  return OOTIQUE_COLORS.find((color) => color.id === colorId) ?? OOTIQUE_COLORS[0];
}

export function createFriendCode(now = Date.now(), random = Math.random()): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let seed = stableHash(`${now}:${random}`);
  let code = '';
  for (let index = 0; index < 6; index += 1) {
    code += alphabet[seed % alphabet.length];
    seed = Math.imul(seed ^ (index + 17), 2246822519) >>> 0;
  }
  return code;
}

// friend-sync 서버는 320~4096px 사이의 JPEG만 받는다. 긴 변을 1600으로 줄이되,
// 그렇게 하면 짧은 변이 하한 밑으로 내려가는 파노라마는 원본 그대로 둔다.
export const UPLOAD_MAX_SIDE = 1600;
const UPLOAD_MIN_SIDE = 320;

export function uploadResizeTarget(
  width: number,
  height: number,
): { width: number } | { height: number } | null {
  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);
  if (longSide <= UPLOAD_MAX_SIDE) return null;
  if ((shortSide * UPLOAD_MAX_SIDE) / longSide < UPLOAD_MIN_SIDE) return null;
  return width >= height ? { width: UPLOAD_MAX_SIDE } : { height: UPLOAD_MAX_SIDE };
}

export function recordId(dateKey: string, mode: ChallengeMode, friendCode = ''): string {
  return `${dateKey}-${mode}-${mode === 'friend' ? normalizeFriendCode(friendCode) : 'solo'}`;
}
