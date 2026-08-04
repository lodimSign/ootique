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
};

export const OOTIQUE_COLORS: readonly OotiqueColor[] = [
  { id: 'butter-yellow', name: '버터 옐로', hex: '#F6D86B', mood: '밝고 따뜻한 오늘의 컬러' },
  { id: 'tomato-red', name: '토마토 레드', hex: '#D95D4F', mood: '생기 있고 대담한 오늘의 컬러' },
  { id: 'denim-blue', name: '데님 블루', hex: '#4F7196', mood: '편안하고 단단한 오늘의 컬러' },
  { id: 'sage-green', name: '세이지 그린', hex: '#93A98C', mood: '차분하고 자연스러운 오늘의 컬러' },
  { id: 'lilac', name: '라일락', hex: '#B7A3D6', mood: '부드럽고 신비로운 오늘의 컬러' },
  { id: 'peach', name: '피치', hex: '#F2B184', mood: '사랑스럽고 산뜻한 오늘의 컬러' },
  { id: 'coral', name: '코랄', hex: '#ED8178', mood: '활기차고 친근한 오늘의 컬러' },
  { id: 'sky-blue', name: '스카이 블루', hex: '#9EC4E5', mood: '맑고 가벼운 오늘의 컬러' },
  { id: 'cream', name: '크림', hex: '#EEDDBA', mood: '포근하고 담백한 오늘의 컬러' },
  { id: 'chocolate', name: '초콜릿', hex: '#765044', mood: '깊고 안정적인 오늘의 컬러' },
  { id: 'charcoal', name: '차콜', hex: '#45464B', mood: '도시적이고 절제된 오늘의 컬러' },
  { id: 'olive', name: '올리브', hex: '#7C824F', mood: '빈티지하고 여유로운 오늘의 컬러' },
  { id: 'rose-pink', name: '로즈 핑크', hex: '#D889A2', mood: '우아하고 낭만적인 오늘의 컬러' },
  { id: 'cobalt', name: '코발트', hex: '#315EB5', mood: '선명하고 자신감 있는 오늘의 컬러' },
  { id: 'mint', name: '민트', hex: '#8FC9B8', mood: '상쾌하고 경쾌한 오늘의 컬러' },
  { id: 'burgundy', name: '버건디', hex: '#7A3344', mood: '성숙하고 분위기 있는 오늘의 컬러' },
  { id: 'apricot', name: '애프리콧', hex: '#EAA26E', mood: '따뜻하고 유쾌한 오늘의 컬러' },
  { id: 'silver-gray', name: '실버 그레이', hex: '#A7A9AE', mood: '깨끗하고 세련된 오늘의 컬러' },
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
