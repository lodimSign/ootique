// 배포된 vote Edge Function을 실제로 호출하는 E2E 진단.
// 소스 문자열을 보는 검사가 아니다 — 서버에 요청을 보내고 상태코드와 본문을 그대로 찍는다.
//
// 실행: npm run test:vote
// 네트워크와 실제 Supabase 프로젝트를 쓴다. npm run check에는 넣지 않는다.

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://lkgipsszgvpcabdefvhc.supabase.co';
const functionUrl = `${supabaseUrl}/functions/v1/vote`;

let failures = 0;

function log(step, status, body) {
  const ok = status >= 200 && status < 300;
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  console.log(`     ${String(status).padEnd(3)} ${step.padEnd(30)} ${text}`);
}

function check(label, condition, detail) {
  if (condition) {
    console.log(`ok   --  ${label}`);
    return true;
  }
  failures += 1;
  console.log(`FAIL --  ${label}  ${detail ?? ''}`);
  return false;
}

async function call(step, action, { token, method = 'POST', json, form, cookie, raw = false } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;

  const url = action.startsWith('?') ? `${functionUrl}${action}` : `${functionUrl}?action=${action}`;
  const response = await fetch(url, { method, headers, body: json ? JSON.stringify(json) : form });
  const setCookie = response.headers.getSetCookie?.() ?? [];

  if (raw) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    log(step, response.status, `${response.headers.get('content-type')} ${bytes.length} bytes`);
    return { status: response.status, bytes, setCookie };
  }
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 120); }
  log(step, response.status, body);
  return { status: response.status, body, text, setCookie };
}

// jpegDimensions()와 stripJpegMetadata()를 통과하는 최소 baseline JPEG.
// 픽셀은 디코딩되지 않는다 — Edge Function은 마커 구조와 크기만 검사한다.
function makeJpeg(size = 1080) {
  const hi = (size >> 8) & 0xff;
  const lo = size & 0xff;
  const head = [
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,
    0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, hi, lo, hi, lo, 0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
  ];
  const scan = new Array(160).fill(0x55);
  return new Uint8Array([...head, ...scan, 0xff, 0xd9]);
}

function publishForm({ colorId = 'sage', pairId, slot, extra } = {}) {
  const form = new FormData();
  form.append('colorId', colorId);
  form.append('photo', new Blob([makeJpeg(1080)], { type: 'image/jpeg' }), 'full.jpg');
  form.append('thumb', new Blob([makeJpeg(600)], { type: 'image/jpeg' }), 'thumb.jpg');
  if (pairId) form.append('pairId', pairId);
  if (slot) form.append('slot', String(slot));
  if (extra) for (const [key, value] of Object.entries(extra)) form.append(key, String(value));
  return form;
}

function cookieFrom(setCookie) {
  const header = (setCookie ?? []).find((value) => value.startsWith('ov='));
  return header ? header.split(';')[0] : null;
}

console.log(`vote E2E → ${functionUrl}\n`);

// 1. 기기 두 대를 등록한다
const deviceA = (await call('A register', 'register')).body;
const deviceB = (await call('B register', 'register')).body;
check('A가 기기 토큰을 받았다', typeof deviceA?.deviceToken === 'string', JSON.stringify(deviceA));
check('B가 기기 토큰을 받았다', typeof deviceB?.deviceToken === 'string', JSON.stringify(deviceB));

// 2. 토큰 없이 공개할 수 없다
const noAuth = await call('토큰 없이 publish', 'publish', { form: publishForm() });
check('토큰 없는 공개가 막힌다', noAuth.status === 401, `status ${noAuth.status}`);

// 3. 혼자 모드 공개 — 링크와 썸네일이 열린다
const solo = await call('A publish (혼자)', 'publish', { token: deviceA?.deviceToken, form: publishForm() });
check('혼자 공개가 shareToken을 준다', typeof solo.body?.shareToken === 'string', JSON.stringify(solo.body));
check('혼자 공개에는 대결 링크가 없다', solo.body?.matchShareToken === null, JSON.stringify(solo.body));

const soloPage = await call('혼자 링크 페이지', `?t=${solo.body?.shareToken}`, { method: 'GET' });
check('혼자 링크가 HTML을 준다', soloPage.status === 200 && soloPage.text?.includes('og:image'), `status ${soloPage.status}`);

const soloImage = await call('혼자 썸네일', `?action=img&t=${solo.body?.shareToken}&side=a`, { method: 'GET', raw: true });
check('썸네일 바이트가 온다', soloImage.bytes?.length > 0, `status ${soloImage.status}`);

// 4. 핵심 — 친구 모드는 두 사람이 모두 공개해야 대결 링크가 생긴다
const pairId = crypto.randomUUID();
const friendA = await call('A publish (친구 slot1)', 'publish', {
  token: deviceA?.deviceToken, form: publishForm({ pairId, slot: 1 }),
});
check('한쪽만 공개하면 대결 링크가 없다', friendA.body?.matchShareToken === null, JSON.stringify(friendA.body));

const friendB = await call('B publish (친구 slot2)', 'publish', {
  token: deviceB?.deviceToken, form: publishForm({ pairId, slot: 2 }),
});
const matchToken = friendB.body?.matchShareToken;
check('두 사람이 공개하면 대결 링크가 생긴다', typeof matchToken === 'string', JSON.stringify(friendB.body));

const matchPage = await call('대결 페이지', `?t=${matchToken}`, { method: 'GET' });
check('대결 페이지가 A/B 버튼을 준다', matchPage.text?.includes('data-side="b"'), `status ${matchPage.status}`);
const voterCookie = cookieFrom(matchPage.setCookie);
check('첫 방문에 투표자 쿠키를 준다', Boolean(voterCookie), JSON.stringify(matchPage.setCookie));

const sideB = await call('대결 B 썸네일', `?action=img&t=${matchToken}&side=b`, { method: 'GET', raw: true });
check('B 썸네일도 열린다', sideB.bytes?.length > 0, `status ${sideB.status}`);

// 5. 본인 투표가 막힌다
const selfVote = await call('A가 자기 대결에 투표', 'vote', {
  token: deviceA?.deviceToken, json: { t: matchToken, side: 'a' }, cookie: voterCookie,
});
check('본인 투표가 막힌다', selfVote.status === 403 && selfVote.body?.error === 'self_vote', JSON.stringify(selfVote.body));

// 6. 익명 웹 투표가 되고, 같은 쿠키의 두 번째 투표는 막힌다
const webVote = await call('웹 투표 1회', 'vote', { json: { t: matchToken, side: 'a' }, cookie: voterCookie });
check('웹 투표가 저장된다', webVote.status === 200 && webVote.body?.a === 1, JSON.stringify(webVote.body));

const dupVote = await call('같은 쿠키 재투표', 'vote', { json: { t: matchToken, side: 'b' }, cookie: voterCookie });
check('중복 투표가 막힌다', dupVote.status === 409 && dupVote.body?.error === 'already_voted', JSON.stringify(dupVote.body));
check('막힌 뒤에도 득표수가 그대로다', dupVote.body?.a === 1 && dupVote.body?.b === 0, JSON.stringify(dupVote.body));

// 7. 앱이 보낸 숫자로 득표수를 바꿀 수 없다
const other = await call('다른 방문자 페이지', `?t=${matchToken}`, { method: 'GET' });
const otherCookie = cookieFrom(other.setCookie);
const forged = await call('조작한 투표 요청', 'vote', {
  json: { t: matchToken, side: 'b', a: 9999, b: 9999, votes_a: 9999 }, cookie: otherCookie,
});
check('서버가 보낸 숫자를 무시한다', forged.body?.a === 1 && forged.body?.b === 1, JSON.stringify(forged.body));

// 8. 없는 토큰은 열리지 않는다
const badToken = await call('없는 토큰', '?t=aaaaaaaaaaaaaaaaaaaaaaaa', { method: 'GET' });
check('없는 토큰이 404다', badToken.status === 404, `status ${badToken.status}`);

// 9. 예약 정리는 기기 토큰으로 열리지 않는다
const badPurge = await call('기기 토큰으로 purge', 'purge', { token: deviceA?.deviceToken });
check('purge가 기기 토큰을 거부한다', badPurge.status === 403, `status ${badPurge.status}`);

// 10. 공개를 내리면 페이지·썸네일·순위에서 모두 빠진다
const hidden = await call('B가 공개 내림', 'unpublish', {
  token: deviceB?.deviceToken, json: { entryId: friendB.body?.entryId },
});
check('공개 내리기가 된다', hidden.status === 200, JSON.stringify(hidden.body));

const goneePage = await call('내린 뒤 대결 페이지', `?t=${matchToken}`, { method: 'GET' });
check('내린 대결 페이지가 404다', goneePage.status === 404, `status ${goneePage.status}`);

const goneImage = await call('내린 뒤 썸네일', `?action=img&t=${matchToken}&side=b`, { method: 'GET', raw: true });
check('내린 썸네일이 404다', goneImage.status === 404, `status ${goneImage.status}`);

const goneVote = await call('내린 뒤 투표', 'vote', { json: { t: matchToken, side: 'a' } });
check('내린 대결에 투표할 수 없다', goneVote.status === 404, JSON.stringify(goneVote.body));

// 11. 남의 엔트리는 내릴 수 없다
const foreign = await call('A가 B 엔트리 내리기', 'unpublish', {
  token: deviceA?.deviceToken, json: { entryId: friendB.body?.entryId },
});
check('남의 엔트리를 내릴 수 없다', foreign.status === 404, `status ${foreign.status}`);

// 12. 순위는 최소 표 수를 넘긴 것만 올린다
const boardResult = await call('순위 조회', 'board', { method: 'GET' });
const listed = (boardResult.body?.entries ?? []).map((row) => row.entryId);
check('표가 모자란 엔트리는 순위에 없다', !listed.includes(friendA.body?.entryId), JSON.stringify(listed));

// 13. 정리 — 검사 데이터를 서버에 남기지 않는다
await call('A 혼자 엔트리 정리', 'unpublish', { token: deviceA?.deviceToken, json: { entryId: solo.body?.entryId } });
await call('A 친구 엔트리 정리', 'unpublish', { token: deviceA?.deviceToken, json: { entryId: friendA.body?.entryId } });

console.log(`\n${failures === 0 ? '전부 통과' : `${failures}건 실패`}`);
process.exit(failures === 0 ? 0 : 1);
