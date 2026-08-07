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

async function call(step, action, { token, method = 'POST', json, form, raw = false } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';

  const url = action.startsWith('?') ? `${functionUrl}${action}` : `${functionUrl}?action=${action}`;
  const response = await fetch(url, { method, headers, body: json ? JSON.stringify(json) : form });

  if (raw) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    log(step, response.status, `${response.headers.get('content-type')} ${bytes.length} bytes`);
    return { status: response.status, bytes };
  }
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 120); }
  log(step, response.status, body);
  return { status: response.status, body, text };
}

// 투표 페이지가 localStorage에 두는 값과 같은 모양이다.
function makeVoter() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');
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

const soloCard = await call('혼자 카드 조회', `?action=card&t=${solo.body?.shareToken}`, { method: 'GET' });
check('혼자 카드가 사진 1장을 준다', soloCard.body?.kind === 'entry' && soloCard.body?.images?.length === 1, JSON.stringify(soloCard.body));
check('이미지 주소가 공개 함수 주소다', soloCard.body?.images?.[0]?.startsWith(`${functionUrl}?action=img`), JSON.stringify(soloCard.body?.images));

// 3-1. 차단용 익명 업로더 해시 — 브라우저가 이 값으로만 거른다
const soloUploader = soloCard.body?.uploaders?.[0];
check('카드가 익명 업로더 해시를 준다', typeof soloUploader === 'string' && /^[0-9a-f]{16}$/.test(soloUploader), JSON.stringify(soloCard.body?.uploaders));
check('업로더 해시가 기기 토큰·기기 ID를 노출하지 않는다',
  soloUploader && !String(deviceA?.deviceToken).includes(soloUploader) && !String(deviceA?.deviceId).includes(soloUploader),
  JSON.stringify({ soloUploader }));

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

const matchCard = await call('대결 카드 조회', `?action=card&t=${matchToken}`, { method: 'GET' });
check('대결 카드가 사진 2장을 준다', matchCard.body?.kind === 'match' && matchCard.body?.images?.length === 2, JSON.stringify(matchCard.body));

// 4-1. 대결 카드의 업로더 해시 — 두 사람이 다르고, 같은 기기는 카드가 달라도 같은 값이다
const matchUploaders = matchCard.body?.uploaders ?? [];
check('대결 카드가 업로더 해시 2개를 준다', matchUploaders.length === 2 && matchUploaders[0] !== matchUploaders[1], JSON.stringify(matchUploaders));
check('같은 기기의 업로더 해시가 카드마다 같다', matchUploaders[0] === soloUploader, JSON.stringify({ soloUploader, matchUploaders }));
const voter = makeVoter();

const sideB = await call('대결 B 썸네일', `?action=img&t=${matchToken}&side=b`, { method: 'GET', raw: true });
check('B 썸네일도 열린다', sideB.bytes?.length > 0, `status ${sideB.status}`);

// 5. 본인 투표가 막힌다
const selfVote = await call('A가 자기 대결에 투표', 'vote', {
  token: deviceA?.deviceToken, json: { t: matchToken, side: 'a', voter },
});
check('본인 투표가 막힌다', selfVote.status === 403 && selfVote.body?.error === 'self_vote', JSON.stringify(selfVote.body));

// 6. 익명 웹 투표가 되고, 같은 사람의 두 번째 투표는 막힌다
const noVoter = await call('투표자 ID 없이 투표', 'vote', { json: { t: matchToken, side: 'a' } });
check('투표자 ID 없는 요청이 막힌다', noVoter.status === 400, JSON.stringify(noVoter.body));

const webVote = await call('웹 투표 1회', 'vote', { json: { t: matchToken, side: 'a', voter } });
check('웹 투표가 저장된다', webVote.status === 200 && webVote.body?.a === 1, JSON.stringify(webVote.body));

const dupVote = await call('같은 사람 재투표', 'vote', { json: { t: matchToken, side: 'b', voter } });
check('중복 투표가 막힌다', dupVote.status === 409 && dupVote.body?.error === 'already_voted', JSON.stringify(dupVote.body));
check('막힌 뒤에도 득표수가 그대로다', dupVote.body?.a === 1 && dupVote.body?.b === 0, JSON.stringify(dupVote.body));

// 7. 앱이 보낸 숫자로 득표수를 바꿀 수 없다
const forged = await call('조작한 투표 요청', 'vote', {
  json: { t: matchToken, side: 'b', voter: makeVoter(), a: 9999, b: 9999, votes_a: 9999 },
});
check('서버가 보낸 숫자를 무시한다', forged.body?.a === 1 && forged.body?.b === 1, JSON.stringify(forged.body));

// 8. 없는 토큰은 열리지 않는다
const badToken = await call('없는 토큰', '?action=card&t=aaaaaaaaaaaaaaaaaaaaaaaa', { method: 'GET' });
check('없는 토큰이 404다', badToken.status === 404, `status ${badToken.status}`);

// 9. 예약 정리는 기기 토큰으로 열리지 않는다
const badPurge = await call('기기 토큰으로 purge', 'purge', { token: deviceA?.deviceToken });
check('purge가 기기 토큰을 거부한다', badPurge.status === 403, `status ${badPurge.status}`);

// 10. 공개를 내리면 페이지·썸네일·순위에서 모두 빠진다
const hidden = await call('B가 공개 내림', 'unpublish', {
  token: deviceB?.deviceToken, json: { entryId: friendB.body?.entryId },
});
check('공개 내리기가 된다', hidden.status === 200, JSON.stringify(hidden.body));

const goneCard = await call('내린 뒤 대결 카드', `?action=card&t=${matchToken}`, { method: 'GET' });
check('내린 대결 카드가 404다', goneCard.status === 404, `status ${goneCard.status}`);

const goneImage = await call('내린 뒤 썸네일', `?action=img&t=${matchToken}&side=b`, { method: 'GET', raw: true });
check('내린 썸네일이 404다', goneImage.status === 404, `status ${goneImage.status}`);

const goneVote = await call('내린 뒤 투표', 'vote', { json: { t: matchToken, side: 'a', voter: makeVoter() } });
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

// 13. 신고 — 저장, 같은 브라우저 중복 1회, 3회째 자동 숨김
// 새 report 액션이 아직 배포 전이면(unknown_action) 이 절만 건너뛴다. 배포 뒤에는 그대로 검사한다.
const deviceC = (await call('C register', 'register')).body;
const reportedEntry = (await call('C publish (신고 대상)', 'publish', {
  token: deviceC?.deviceToken, form: publishForm(),
})).body;
const reportToken = reportedEntry?.shareToken;
const reporter1 = makeVoter();

const report1 = await call('신고 1회', 'report', {
  json: { t: reportToken, side: 'a', reason: 'inappropriate', reporter: reporter1 },
});
if (report1.body?.error === 'unknown_action') {
  console.log('skip --  report 액션이 아직 배포되지 않아 신고 검사를 건너뛴다');
  await call('C 엔트리 정리', 'unpublish', { token: deviceC?.deviceToken, json: { entryId: reportedEntry?.entryId } });
} else {
  check('신고가 저장된다', report1.status === 200 && report1.body?.reportCount === 1 && report1.body?.hidden === false, JSON.stringify(report1.body));

  const reportDup = await call('같은 브라우저 재신고', 'report', {
    json: { t: reportToken, side: 'a', reason: 'spam', reporter: reporter1 },
  });
  check('같은 브라우저 중복 신고는 1회로 센다', reportDup.status === 200 && reportDup.body?.reportCount === 1 && reportDup.body?.hidden === false, JSON.stringify(reportDup.body));

  const badReason = await call('없는 사유로 신고', 'report', {
    json: { t: reportToken, side: 'a', reason: 'whatever', reporter: makeVoter() },
  });
  check('없는 사유가 400이다', badReason.status === 400, `status ${badReason.status}`);

  const report2 = await call('신고 2회 (다른 브라우저)', 'report', {
    json: { t: reportToken, side: 'a', reason: 'spam', reporter: makeVoter() },
  });
  check('2회까지는 공개가 유지된다', report2.body?.reportCount === 2 && report2.body?.hidden === false, JSON.stringify(report2.body));
  const cardBefore = await call('2회 신고 뒤 카드', `?action=card&t=${reportToken}`, { method: 'GET' });
  check('2회 신고 뒤에도 카드가 열린다', cardBefore.status === 200, `status ${cardBefore.status}`);

  const report3 = await call('신고 3회 (다른 브라우저)', 'report', {
    json: { t: reportToken, side: 'a', reason: 'other', reporter: makeVoter() },
  });
  check('3회째 자동 숨김이 된다', report3.body?.reportCount === 3 && report3.body?.hidden === true, JSON.stringify(report3.body));

  const hiddenCard = await call('숨김 뒤 카드', `?action=card&t=${reportToken}`, { method: 'GET' });
  check('숨긴 카드가 404다', hiddenCard.status === 404, `status ${hiddenCard.status}`);
  const hiddenImage = await call('숨김 뒤 썸네일', `?action=img&t=${reportToken}&side=a`, { method: 'GET', raw: true });
  check('숨긴 썸네일이 404다', hiddenImage.status === 404, `status ${hiddenImage.status}`);
  const hiddenReport = await call('숨김 뒤 추가 신고', 'report', {
    json: { t: reportToken, side: 'a', reason: 'spam', reporter: makeVoter() },
  });
  check('숨긴 카드에는 더 신고할 수 없다', hiddenReport.status === 404, `status ${hiddenReport.status}`);
  // 숨긴 엔트리와 파일은 검토용으로 서버에 남긴다(삭제 금지). 7일 purge가 정리한다.
}

// 14. 정리 — 검사 데이터를 서버에 남기지 않는다
await call('A 혼자 엔트리 정리', 'unpublish', { token: deviceA?.deviceToken, json: { entryId: solo.body?.entryId } });
await call('A 친구 엔트리 정리', 'unpublish', { token: deviceA?.deviceToken, json: { entryId: friendA.body?.entryId } });

console.log(`\n${failures === 0 ? '전부 통과' : `${failures}건 실패`}`);
process.exit(failures === 0 ? 0 : 1);
