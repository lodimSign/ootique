import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20260803113000_friend_sync.sql', import.meta.url), 'utf8');
const edge = readFileSync(new URL('../supabase/functions/friend-sync/index.ts', import.meta.url), 'utf8');
const client = readFileSync(new URL('../src/friendSync.ts', import.meta.url), 'utf8');
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

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
assert.match(app, /writeTemporaryJpeg\(result\.assets\[0\]\.base64\)/);
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

console.log('friend sync security invariants: ok');
