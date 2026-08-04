// 소스 불변식 검사 — 서버를 호출하지 않는다.
// 여기서 보는 것은 "위험한 코드가 다시 들어오지 않았는가"(공개 URL, 서비스 키, 세션 오용)뿐이다.
// 실제로 동작하는지는 이 검사로 알 수 없다. 동작 확인은 scripts/friend-sync-e2e.mjs와 두 기기 수동 확인이다.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20260803113000_friend_sync.sql', import.meta.url), 'utf8');
const edge = readFileSync(new URL('../supabase/functions/friend-sync/index.ts', import.meta.url), 'utf8');
const client = readFileSync(new URL('../src/friendSync.ts', import.meta.url), 'utf8');
const app = [
  '../App.tsx',
  '../src/components/ui.tsx',
  '../src/components/RouletteMachine.tsx',
  '../src/components/TodayScreen.tsx',
  '../src/components/CaptureScreen.tsx',
  '../src/components/ShareScreen.tsx',
  '../src/components/HistoryScreen.tsx',
].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');

assert.match(sql, /public = false/);
assert.match(sql, /array\['image\/jpeg'\]/);
assert.match(sql, /enable row level security/g);
assert.match(sql, /approve_friend_join/);
assert.match(sql, /for update/);
assert.match(edge, /crypto\.getRandomValues/);
assert.match(edge, /SHA-256/);
assert.match(edge, /member\.status !== 'active'/);
assert.match(edge, /Cache-Control': 'private, no-store'/);
assert.match(edge, /stripJpegMetadata/);
assert.doesNotMatch(edge, /getPublicUrl|createSignedUrl/);
assert.match(client, /SecureStore\.setItemAsync/);
assert.match(client, /WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
assert.doesNotMatch(client, /SERVICE_ROLE/);
assert.match(app, /Clipboard\.setStringAsync\(session\.inviteCode\)/);
assert.match(app, /Clipboard\.getStringAsync\(\)/);
assert.match(app, /props\.friendCode\.length}\/6/);
assert.doesNotMatch(app, /친구 사진 선택/);
// 고른 사진을 그대로 올리면 PNG 스크린샷·고해상도 원본이 서버에서 invalid_photo로 막힌다.
assert.match(app, /toUploadJpeg\(result\.assets\[0\]\.uri\)/);
assert.match(app, /friendSessionMatchesCode\(friendSession\.inviteCode, normalizedCode\)/);
assert.match(app, /friendState\?\.pairId === matchingFriendSession\.pairId/);
assert.match(app, /getFriendState\(matchingFriendSession\)/);
assert.match(app, /friendPhotoSource\(matchingFriendSession/);
assert.match(app, /approveFriendJoin\(matchingFriendSession\)/);
assert.match(app, /uploadOwnFriendPhoto\(matchingFriendSession/);
assert.doesNotMatch(app, /getFriendState\(friendSession\)/);
assert.doesNotMatch(app, /friendPhotoSource\(friendSession/);
assert.doesNotMatch(app, /approveFriendJoin\(friendSession\)/);
assert.doesNotMatch(app, /uploadOwnFriendPhoto\(friendSession/);

// 친구 사진은 인증 헤더가 필요한 서버 URL이다. 화면과 기록에는 기기 파일 경로만 들어가야 한다.
assert.match(app, /downloadPhoto\(\s*source,/);
assert.match(app, /copyPhoto\(friendUri, `\$\{id\}-friend`\)/);
assert.doesNotMatch(app, /headers: friendHeaders/);
assert.doesNotMatch(app, /source=\{\{ uri, headers \}\}/);

console.log('friend sync source invariants: ok (서버 미호출 — 동작 확인은 test:friend-sync:e2e)');
