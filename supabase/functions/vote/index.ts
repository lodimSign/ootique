// 공개 투표와 순위 (A단계).
// 앱은 이 함수만 호출하고, 링크를 받은 사람은 GET ?t=<token>으로 웹 투표 페이지를 본다.
// 명세: docs/friend-flow-scenario.md `A단계 실행 스펙` 절.
//
// ponytail: jpegDimensions / stripJpegMetadata는 friend-sync/index.ts에서 그대로 복사했다.
// 배포된 보안 함수를 건드리지 않으려고 공유 모듈로 빼지 않았다. 셋째 함수가 생기면 _shared로 옮긴다.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };
const BUCKET = 'public-entries';
const MIN_BOARD_VOTES = 5;
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);
const voteSecret = Deno.env.get('VOTE_SECRET') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(status: number, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...jsonHeaders, ...extraHeaders } });
}

function randomToken(bytes = 24) {
  const source = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...source)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function seoulDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function bearer(req: Request) {
  const value = req.headers.get('authorization') ?? '';
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

async function authenticate(req: Request) {
  const token = bearer(req);
  if (!token) return null;
  const { data } = await supabase
    .from('vote_devices')
    .select('id')
    .eq('token_hash', await sha256(token))
    .maybeSingle();
  return data ?? null;
}

async function consumeRateLimit(req: Request, action: string, limit: number) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const keyHash = await sha256(`${ip}:vote:${action}`);
  const { data, error } = await supabase.rpc('consume_friend_rate_limit', {
    p_key_hash: keyHash, p_limit: limit, p_window_seconds: 60,
  });
  return !error && data === true;
}

function jpegDimensions(bytes: Uint8Array) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const size = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (size < 2 || offset + size + 2 > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: (bytes[offset + 5] << 8) | bytes[offset + 6], width: (bytes[offset + 7] << 8) | bytes[offset + 8] };
    }
    offset += size + 2;
  }
  return null;
}

function stripJpegMetadata(bytes: Uint8Array) {
  const chunks = [bytes.slice(0, 2)];
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    if (marker === 0xda) { chunks.push(bytes.slice(offset)); break; }
    if (marker === 0xd9) { chunks.push(bytes.slice(offset, offset + 2)); break; }
    const size = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (size < 2 || offset + size + 2 > bytes.length) throw new Error('invalid_jpeg');
    if (!(marker >= 0xe0 && marker <= 0xef) && marker !== 0xfe) chunks.push(bytes.slice(offset, offset + size + 2));
    offset += size + 2;
  }
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(length);
  let cursor = 0;
  for (const chunk of chunks) { output.set(chunk, cursor); cursor += chunk.length; }
  return output;
}

async function readJpeg(file: unknown, minSide: number, maxSide: number) {
  if (!(file instanceof File) || file.type !== 'image/jpeg' || file.size < 100 || file.size > 5_242_880) return null;
  const original = new Uint8Array(await file.arrayBuffer());
  const size = jpegDimensions(original);
  if (!size) return null;
  const longest = Math.max(size.width, size.height);
  if (longest < minSide || longest > maxSide) return null;
  try { return stripJpegMetadata(original); } catch { return null; }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!
  ));
}

function voterCookie(req: Request) {
  const raw = req.headers.get('cookie') ?? '';
  const match = raw.match(/(?:^|;\s*)ov=([A-Za-z0-9_-]{16,64})(?:;|$)/);
  return match?.[1] ?? null;
}

function setCookie(id: string) {
  return { 'Set-Cookie': `ov=${id}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax` };
}

async function register(req: Request) {
  if (!await consumeRateLimit(req, 'register', 10)) return json(429, { error: 'too_many_requests' });
  const deviceToken = randomToken(32);
  const { data, error } = await supabase
    .from('vote_devices')
    .insert({ token_hash: await sha256(deviceToken) })
    .select('id')
    .single();
  if (error || !data) return json(500, { error: 'register_failed' });
  return json(200, { deviceId: data.id, deviceToken });
}

async function publish(req: Request) {
  const device = await authenticate(req);
  if (!device) return json(401, { error: 'unauthorized' });
  if (!await consumeRateLimit(req, 'publish', 12)) return json(429, { error: 'too_many_requests' });

  const form = await req.formData();
  const photo = await readJpeg(form.get('photo'), 320, 1600);
  const thumb = await readJpeg(form.get('thumb'), 200, 900);
  const colorId = String(form.get('colorId') ?? '').slice(0, 40);
  if (!photo || !thumb || !colorId) return json(400, { error: 'invalid_photo' });

  const rawPairId = String(form.get('pairId') ?? '');
  const pairId = /^[0-9a-f-]{36}$/i.test(rawPairId) ? rawPairId : null;
  const slotValue = Number(form.get('slot') ?? 0);
  const ownerSlot = pairId && (slotValue === 1 || slotValue === 2) ? slotValue : null;
  if (pairId && !ownerSlot) return json(400, { error: 'invalid_slot' });

  const entryId = crypto.randomUUID();
  const objectKey = `${entryId}/full.jpg`;
  const thumbKey = `${entryId}/thumb.jpg`;
  const uploadFull = await supabase.storage.from(BUCKET).upload(objectKey, photo, { contentType: 'image/jpeg', upsert: false });
  if (uploadFull.error) return json(500, { error: 'upload_failed' });
  const uploadThumb = await supabase.storage.from(BUCKET).upload(thumbKey, thumb, { contentType: 'image/jpeg', upsert: false });
  if (uploadThumb.error) {
    await supabase.storage.from(BUCKET).remove([objectKey]);
    return json(500, { error: 'upload_failed' });
  }

  const shareToken = randomToken();
  const { error } = await supabase.from('vote_entries').insert({
    id: entryId,
    device_id: device.id,
    challenge_date: seoulDate(),
    color_id: colorId,
    object_key: objectKey,
    thumb_key: thumbKey,
    share_token: shareToken,
    status: 'public',
    pair_id: pairId,
    owner_slot: ownerSlot,
  });
  if (error) {
    await supabase.storage.from(BUCKET).remove([objectKey, thumbKey]);
    return json(error.code === '23505' ? 409 : 500, { error: error.code === '23505' ? 'already_published' : 'publish_failed' });
  }

  // 두 사람이 모두 공개했을 때만 A/B 대결과 그 링크가 생긴다.
  let matchShareToken: string | null = null;
  if (pairId) {
    const { data } = await supabase.rpc('ensure_vote_match', { p_pair_id: pairId, p_share_token: randomToken() });
    matchShareToken = data?.[0]?.match_share_token ?? null;
  }
  return json(200, { entryId, shareToken, matchShareToken });
}

async function unpublish(req: Request, body: Record<string, unknown>) {
  const device = await authenticate(req);
  if (!device) return json(401, { error: 'unauthorized' });
  const entryId = String(body.entryId ?? '');
  const { data, error } = await supabase
    .from('vote_entries')
    .update({ status: 'hidden', object_key: null, thumb_key: null })
    .eq('id', entryId)
    .eq('device_id', device.id)
    .neq('status', 'hidden')
    .select('id')
    .maybeSingle();
  if (error) return json(500, { error: 'unpublish_failed' });
  if (!data) return json(404, { error: 'entry_not_found' });
  await supabase.storage.from(BUCKET).remove([`${entryId}/full.jpg`, `${entryId}/thumb.jpg`]);
  return json(200, { status: 'hidden' });
}

type Side = { entryId: string; thumbKey: string; colorId: string };

async function resolveToken(token: string) {
  const { data: match } = await supabase
    .from('vote_matches')
    .select('id,share_token,entry_a,entry_b')
    .eq('share_token', token)
    .maybeSingle();
  if (match) {
    const { data: entries } = await supabase
      .from('vote_entries')
      .select('id,thumb_key,color_id,status')
      .in('id', [match.entry_a, match.entry_b]);
    const a = entries?.find((item) => item.id === match.entry_a);
    const b = entries?.find((item) => item.id === match.entry_b);
    if (!a || !b || a.status !== 'public' || b.status !== 'public') return null;
    return {
      kind: 'match' as const,
      matchId: match.id,
      sides: [
        { entryId: a.id, thumbKey: a.thumb_key!, colorId: a.color_id },
        { entryId: b.id, thumbKey: b.thumb_key!, colorId: b.color_id },
      ] as Side[],
    };
  }
  const { data: entry } = await supabase
    .from('vote_entries')
    .select('id,thumb_key,color_id,status')
    .eq('share_token', token)
    .maybeSingle();
  if (!entry || entry.status !== 'public') return null;
  return {
    kind: 'entry' as const,
    matchId: null,
    sides: [{ entryId: entry.id, thumbKey: entry.thumb_key!, colorId: entry.color_id }] as Side[],
  };
}

// 먼저 공개한 사람은 대결 링크가 아직 없다. 상대가 공개한 뒤 다시 물으면 대결 링크를 돌려준다.
async function link(url: URL) {
  const token = url.searchParams.get('t') ?? '';
  const { data: entry } = await supabase
    .from('vote_entries')
    .select('id,pair_id,status')
    .eq('share_token', token)
    .maybeSingle();
  if (!entry || entry.status !== 'public') return json(404, { error: 'not_found' });
  if (!entry.pair_id) return json(200, { shareToken: token, kind: 'entry' });

  const { data } = await supabase.rpc('ensure_vote_match', {
    p_pair_id: entry.pair_id, p_share_token: randomToken(),
  });
  const matchToken = data?.[0]?.match_share_token;
  return json(200, matchToken ? { shareToken: matchToken, kind: 'match' } : { shareToken: token, kind: 'entry' });
}

async function image(url: URL) {
  const token = url.searchParams.get('t') ?? '';
  const side = url.searchParams.get('side') === 'b' ? 1 : 0;
  const resolved = await resolveToken(token);
  const target = resolved?.sides[side];
  if (!target?.thumbKey) return json(404, { error: 'not_found' });
  const { data, error } = await supabase.storage.from(BUCKET).download(target.thumbKey);
  if (error || !data) return json(404, { error: 'not_found' });
  return new Response(await data.arrayBuffer(), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=300' },
  });
}

async function tallies(matchId: string, entryA: string, entryB: string) {
  const { data } = await supabase.from('votes').select('entry_id').eq('match_id', matchId);
  const rows = data ?? [];
  return {
    a: rows.filter((row) => row.entry_id === entryA).length,
    b: rows.filter((row) => row.entry_id === entryB).length,
  };
}

async function votePage(req: Request, url: URL, token: string) {
  const resolved = await resolveToken(token);
  if (!resolved) {
    return new Response(page('지난 카드예요', '<p class="msg">공개가 내려갔거나 7일이 지나 사라진 카드입니다.</p>', ''), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
  const base = `${url.origin}${url.pathname}`;
  const imageA = `${base}?action=img&t=${encodeURIComponent(token)}&side=a`;
  const imageB = `${base}?action=img&t=${encodeURIComponent(token)}&side=b`;
  const isMatch = resolved.kind === 'match';
  const title = isMatch ? '누가 오늘의 컬러를 더 잘 살렸나요?' : '오늘의 컬러를 입고 나왔어요';

  const body = isMatch
    ? `<div class="pair">
         <button class="side" data-side="a"><img alt="A" src="${imageA}"><span>A</span></button>
         <button class="side" data-side="b"><img alt="B" src="${imageB}"><span>B</span></button>
       </div>
       <p class="msg" id="msg">마음에 드는 쪽을 눌러주세요.</p>`
    : `<div class="solo"><img alt="OOTD" src="${imageA}"></div>
       <p class="msg">Ootique에서 오늘의 컬러를 받아보세요.</p>`;

  const script = isMatch
    ? `<script>
document.querySelectorAll('.side').forEach(function (el) {
  el.addEventListener('click', function () {
    document.querySelectorAll('.side').forEach(function (b) { b.disabled = true; });
    fetch(${JSON.stringify(base)} + '?action=vote', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ t: ${JSON.stringify(token)}, side: el.dataset.side })
    }).then(function (r) { return r.json(); }).then(function (d) {
      var msg = document.getElementById('msg');
      if (d.error === 'already_voted') { msg.textContent = '이미 투표하셨어요. A ' + d.a + ' · B ' + d.b; return; }
      if (d.error) { msg.textContent = '투표를 저장하지 못했어요.'; document.querySelectorAll('.side').forEach(function (b) { b.disabled = false; }); return; }
      msg.textContent = '고마워요! A ' + d.a + ' · B ' + d.b;
    }).catch(function () {
      document.getElementById('msg').textContent = '연결에 실패했어요. 다시 시도해 주세요.';
      document.querySelectorAll('.side').forEach(function (b) { b.disabled = false; });
    });
  });
});
</script>`
    : '';

  const html = page(title, body + script, imageA);
  const cookie = voterCookie(req) ? {} : setCookie(randomToken(16));
  return new Response(html, {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8', ...cookie },
  });
}

function page(title: string, inner: string, ogImage: string) {
  return `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ootique — ${escapeHtml(title)}</title>
<meta property="og:title" content="Ootique — ${escapeHtml(title)}">
<meta property="og:description" content="오늘의 랜덤 컬러를 살린 OOTD. 눌러서 투표하고 앱도 받아보세요.">
${ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<style>
:root{color-scheme:light dark}
body{margin:0;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#FAF7F1;color:#2A2622;display:flex;flex-direction:column;align-items:center;gap:16px}
h1{font-size:20px;margin:0;text-align:center}
.brand{font-size:14px;letter-spacing:.18em;text-transform:uppercase;color:#8A8177}
.pair{display:flex;gap:10px;width:100%;max-width:520px}
.side{flex:1;padding:0;border:1px solid #E4DED3;border-radius:20px;overflow:hidden;background:#EFEAE1;position:relative;cursor:pointer}
.side:disabled{opacity:.6;cursor:default}
.side img,.solo img{display:block;width:100%;aspect-ratio:4/5;object-fit:cover}
.side span{position:absolute;left:10px;top:10px;background:rgba(0,0,0,.55);color:#fff;font-weight:700;border-radius:999px;padding:2px 10px}
.solo{width:100%;max-width:340px;border:1px solid #E4DED3;border-radius:20px;overflow:hidden}
.msg{margin:0;text-align:center;color:#6B6358;min-height:22px}
.get{margin-top:8px;padding:14px 28px;border-radius:999px;background:#2A2622;color:#FAF7F1;text-decoration:none;font-weight:700}
.note{font-size:12px;color:#8A8177;text-align:center;max-width:340px}
@media (prefers-color-scheme:dark){body{background:#1B1917;color:#F2EDE5}.msg{color:#B6ADA1}.get{background:#F2EDE5;color:#1B1917}}
</style>
</head><body>
<div class="brand">ootique</div>
<h1>${escapeHtml(title)}</h1>
${inner}
<a class="get" href="#">앱 받기 · 곧 출시</a>
<p class="note">Ootique는 매일 하나의 랜덤 컬러를 주고, 그 컬러를 살린 오늘의 옷을 기록하는 앱입니다.</p>
</body></html>`;
}

async function castVote(req: Request, body: Record<string, unknown>) {
  if (!await consumeRateLimit(req, 'vote', 30)) return json(429, { error: 'too_many_requests' });
  const token = String(body.t ?? '');
  const resolved = await resolveToken(token);
  if (!resolved || resolved.kind !== 'match') return json(404, { error: 'not_found' });

  const sideIndex = body.side === 'b' ? 1 : 0;
  const chosen = resolved.sides[sideIndex];
  const [a, b] = resolved.sides;

  let cookieId = voterCookie(req);
  const freshCookie = !cookieId;
  if (!cookieId) cookieId = randomToken(16);
  const voterHash = await sha256(`${cookieId}:${voteSecret}`);
  const device = await authenticate(req);
  const headers = freshCookie ? setCookie(cookieId) : {};

  const { data, error } = await supabase.rpc('cast_vote', {
    p_match_id: resolved.matchId,
    p_voter_hash: voterHash,
    p_entry_id: chosen.entryId,
    p_device_id: device?.id ?? null,
  });
  if (error) {
    const counts = await tallies(resolved.matchId!, a.entryId, b.entryId);
    const known = ['self_vote', 'entry_not_public', 'entry_not_in_match', 'match_not_found'];
    const reason = known.find((name) => error.message?.includes(name));
    if (error.code === '23505' || error.message?.includes('duplicate key')) {
      return json(409, { error: 'already_voted', ...counts }, headers);
    }
    return json(reason === 'self_vote' ? 403 : 400, { error: reason ?? 'vote_failed', ...counts }, headers);
  }
  const row = data?.[0];
  return json(200, { a: Number(row?.votes_a ?? 0), b: Number(row?.votes_b ?? 0) }, headers);
}

async function board(url: URL) {
  const date = url.searchParams.get('date') || seoulDate();
  const { data, error } = await supabase
    .from('vote_standings')
    .select('entry_id,challenge_date,color_id,share_token,votes_for,votes_total')
    .eq('challenge_date', date)
    .gte('votes_total', MIN_BOARD_VOTES);
  if (error) return json(500, { error: 'board_failed' });
  const ranked = (data ?? [])
    .map((row) => ({
      entryId: row.entry_id,
      colorId: row.color_id,
      shareToken: row.share_token,
      votesFor: row.votes_for,
      votesTotal: row.votes_total,
      winRate: row.votes_total > 0 ? row.votes_for / row.votes_total : 0,
    }))
    .sort((left, right) => right.winRate - left.winRate || right.votesTotal - left.votesTotal)
    .slice(0, 50);
  return json(200, { date, minVotes: MIN_BOARD_VOTES, entries: ranked });
}

// 정리는 예약 작업만 부른다. 기기 토큰으로는 열리지 않는다.
async function purge(req: Request) {
  if (bearer(req) !== Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')) return json(403, { error: 'forbidden' });
  const { data, error } = await supabase.rpc('purge_expired_vote_entries');
  if (error) return json(500, { error: 'purge_failed' });
  const keys = (data ?? []).flatMap((row: { object_key: string | null; thumb_key: string | null }) =>
    [row.object_key, row.thumb_key].filter(Boolean) as string[]);
  if (keys.length) await supabase.storage.from(BUCKET).remove(keys);
  return json(200, { removed: keys.length });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action') ?? '';
    const token = url.searchParams.get('t') ?? '';

    if (req.method === 'GET' && action === 'img') return await image(url);
    if (req.method === 'GET' && action === 'link') return await link(url);
    if (req.method === 'GET' && action === 'board') return await board(url);
    if (req.method === 'GET' && token) return await votePage(req, url, token);
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

    if (action === 'register') return await register(req);
    if (action === 'publish') return await publish(req);
    if (action === 'purge') return await purge(req);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (action === 'vote') return await castVote(req, body);
    if (action === 'unpublish') return await unpublish(req, body);
    return json(404, { error: 'unknown_action' });
  } catch {
    return json(500, { error: 'server_error' });
  }
});
