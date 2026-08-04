// 배포된 friend-sync Edge Function을 실제로 호출하는 E2E 진단.
// friend-sync-check.mjs와 다르다 — 저건 소스 문자열만 보고, 이건 서버에 요청을 보낸다.
// 두 기기 없이 A/B 두 세션을 흉내내서 어느 단계에서 끊기는지 상태코드와 본문을 그대로 찍는다.
//
// 실행: npm run test:friend-sync:e2e
// 네트워크와 실제 Supabase 프로젝트를 쓴다. npm run check에는 넣지 않는다.

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://lkgipsszgvpcabdefvhc.supabase.co';
const functionUrl = `${supabaseUrl}/functions/v1/friend-sync`;

let failures = 0;

function log(step, status, body) {
  const ok = status >= 200 && status < 300;
  if (!ok) failures += 1;
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${String(status).padEnd(3)} ${step.padEnd(28)} ${text}`);
}

async function call(step, action, { token, method = 'POST', json, form, raw = false } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${functionUrl}?action=${action}`, {
    method,
    headers,
    body: json ? JSON.stringify(json) : form,
  });

  if (raw && response.ok) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    const body = `${response.headers.get('content-type')} ${bytes.length} bytes`;
    log(step, response.status, body);
    return { status: response.status, bytes };
  }

  const body = await response.json().catch(() => ({ '<non-json>': true }));
  log(step, response.status, body);
  return { status: response.status, body };
}

// jpegDimensions()와 stripJpegMetadata()를 통과하는 최소 baseline JPEG.
// 픽셀은 디코딩되지 않는다 — Edge Function은 마커 구조와 크기만 검사한다.
function makeJpeg(size = 400) {
  const hi = (size >> 8) & 0xff;
  const lo = size & 0xff;
  const head = [
    0xff, 0xd8,                                                  // SOI
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,        // APP0 (JFIF) — strip 대상
    0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, hi, lo, hi, lo, 0x03,          // SOF0: height, width, 3 components
    0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,  // SOS
  ];
  const scan = new Array(160).fill(0x55);                        // 최소 크기(100바이트) 확보용
  return new Uint8Array([...head, ...scan, 0xff, 0xd9]);         // EOI
}

function photoForm(bytes, expectedVersion) {
  const form = new FormData();
  form.append('expectedVersion', String(expectedVersion));
  form.append('file', new Blob([bytes], { type: 'image/jpeg' }), 'ootd.jpg');
  return form;
}

function partnerPhoto(body, slot) {
  return (body?.photos ?? []).find((photo) => photo.slot === slot && photo.available);
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

console.log(`friend-sync E2E → ${functionUrl}\n`);

// 1. A가 방을 만든다
const created = await call('A create', 'create');
const a = created.body;
check('A가 inviteCode를 받았다', typeof a?.inviteCode === 'string' && a.inviteCode.length === 6, JSON.stringify(a));
check('A가 slot 1이다', a?.slot === 1);

// 2. B가 참가한다
const joined = await call('B join', 'join', { json: { inviteCode: a?.inviteCode } });
const b = joined.body;
check('B가 slot 2다', b?.slot === 2, JSON.stringify(b));

// 3. A가 참가 요청을 본다
const beforeApprove = await call('A state (승인 전)', 'state', { token: a?.memberToken, method: 'GET' });
check('A에게 pendingJoin이 보인다', beforeApprove.body?.pendingJoin === true, JSON.stringify(beforeApprove.body));

// 4. A가 승인한다
await call('A approve', 'approve', { token: a?.memberToken });

// 5. 양쪽 상태가 active인가
const aActive = await call('A state (승인 후)', 'state', { token: a?.memberToken, method: 'GET' });
check('A의 방이 active다', aActive.body?.status === 'active', JSON.stringify(aActive.body));

const bActive = await call('B state (승인 후)', 'state', { token: b?.memberToken, method: 'GET' });
check('B의 방이 active다', bActive.body?.status === 'active', JSON.stringify(bActive.body));
check('B가 photos 배열을 받는다', Array.isArray(bActive.body?.photos), JSON.stringify(bActive.body));

// 6. A가 사진을 올린다 → B에게 보이는가 (핵심 구간)
const aUpload = await call('A upload', 'upload', { token: a?.memberToken, form: photoForm(makeJpeg(), 0) });
check('A 사진 version이 1이다', Number(aUpload.body?.version) === 1, JSON.stringify(aUpload.body));

const bSeesA = await call('B state (A 업로드 후)', 'state', { token: b?.memberToken, method: 'GET' });
const aPhoto = partnerPhoto(bSeesA.body, 1);
check('B에게 A 사진이 보인다', Boolean(aPhoto), JSON.stringify(bSeesA.body));

const bDownload = await call('B GET A 사진', `photo&slot=1&v=${aPhoto?.version ?? 1}`, {
  token: b?.memberToken, method: 'GET', raw: true,
});
check('B가 A 사진 바이트를 받는다', bDownload.bytes?.length > 0, `status ${bDownload.status}`);

// 7. 반대 방향
const bUpload = await call('B upload', 'upload', { token: b?.memberToken, form: photoForm(makeJpeg(480), 0) });
check('B 사진 version이 1이다', Number(bUpload.body?.version) === 1, JSON.stringify(bUpload.body));

const aSeesB = await call('A state (B 업로드 후)', 'state', { token: a?.memberToken, method: 'GET' });
const bPhoto = partnerPhoto(aSeesB.body, 2);
check('A에게 B 사진이 보인다', Boolean(bPhoto), JSON.stringify(aSeesB.body));

const aDownload = await call('A GET B 사진', `photo&slot=2&v=${bPhoto?.version ?? 1}`, {
  token: a?.memberToken, method: 'GET', raw: true,
});
check('A가 B 사진 바이트를 받는다', aDownload.bytes?.length > 0, `status ${aDownload.status}`);

// 8. 교체 — version이 올라가고 상대에게 반영되는가
const aReplace = await call('A 사진 교체', 'upload', { token: a?.memberToken, form: photoForm(makeJpeg(640), 1) });
check('교체 후 version이 2다', Number(aReplace.body?.version) === 2, JSON.stringify(aReplace.body));

const bSeesReplace = await call('B state (교체 후)', 'state', { token: b?.memberToken, method: 'GET' });
check('B가 version 2를 본다', Number(partnerPhoto(bSeesReplace.body, 1)?.version) === 2, JSON.stringify(bSeesReplace.body));

// 9. 권한 — 토큰 없이 사진에 접근할 수 없어야 한다
const noAuth = await fetch(`${functionUrl}?action=photo&slot=1&v=2`);
check('토큰 없는 사진 접근이 막힌다', noAuth.status === 401 || noAuth.status === 403, `status ${noAuth.status}`);

// 10. 정리 — 검사 데이터를 서버에 남기지 않는다
await call('A delete', 'delete', { token: a?.memberToken, json: { expectedVersion: 2 } });
await call('B delete', 'delete', { token: b?.memberToken, json: { expectedVersion: 1 } });

console.log(`\n${failures === 0 ? '전부 통과' : `${failures}건 실패`}`);
process.exit(failures === 0 ? 0 : 1);
