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
// 함수 안에서 본 url.origin은 내부 주소(http://<ref>.supabase.co/vote)라 외부에 그대로 쓸 수 없다.
const PUBLIC_FUNCTION_URL = `${Deno.env.get('SUPABASE_URL')}/functions/v1/vote`;
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

// 투표 페이지는 GitHub Pages의 정적 docs/v.html이 그린다.
// Supabase Edge Function은 HTML을 돌려줄 수 없다 — 게이트웨이가 text/plain과
// `CSP: default-src 'none'; sandbox`를 강제로 붙여 스크립트도 이미지도 막힌다(2026-08-06 실측).
// 그래서 여기서는 화면에 필요한 값만 JSON으로 준다.
async function card(url: URL) {
  const token = url.searchParams.get('t') ?? '';
  const resolved = await resolveToken(token);
  if (!resolved) return json(404, { error: 'not_found' });
  const base = `${PUBLIC_FUNCTION_URL}?action=img&t=${encodeURIComponent(token)}`;
  return json(200, {
    kind: resolved.kind,
    colorId: resolved.sides[0].colorId,
    images: resolved.sides.map((_, index) => `${base}&side=${index === 0 ? 'a' : 'b'}`),
  }, { 'Cache-Control': 'no-store' });
}

async function castVote(req: Request, body: Record<string, unknown>) {
  if (!await consumeRateLimit(req, 'vote', 30)) return json(429, { error: 'too_many_requests' });
  const token = String(body.t ?? '');
  const resolved = await resolveToken(token);
  if (!resolved || resolved.kind !== 'match') return json(404, { error: 'not_found' });

  const sideIndex = body.side === 'b' ? 1 : 0;
  const chosen = resolved.sides[sideIndex];
  const [a, b] = resolved.sides;

  // 투표자 식별은 페이지가 localStorage에 보관하는 임의 ID다. 쿠키를 쓰면 페이지와 함수의
  // 도메인이 달라 사파리·크롬의 서드파티 차단에 걸린다. 원문은 저장하지 않고 해시만 쓴다.
  const voterId = String(body.voter ?? '');
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(voterId)) return json(400, { error: 'invalid_voter' });
  const voterHash = await sha256(`${voterId}:${voteSecret}`);
  const device = await authenticate(req);
  const headers = {};

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

    if (req.method === 'GET' && action === 'img') return await image(url);
    if (req.method === 'GET' && action === 'link') return await link(url);
    if (req.method === 'GET' && action === 'board') return await board(url);
    if (req.method === 'GET' && action === 'card') return await card(url);
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
