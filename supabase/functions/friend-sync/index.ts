import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };
const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function randomText(length: number, source = crypto.getRandomValues(new Uint8Array(length))) {
  return Array.from(source, (byte) => alphabet[byte % alphabet.length]).join('');
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
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
  const tokenHash = await sha256(token);
  const { data: member } = await supabase
    .from('friend_members')
    .select('id,pair_id,slot,status')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (!member) return null;
  const { data: pair } = await supabase
    .from('friend_pairs')
    .select('id,challenge_date,status,version,invite_expires_at')
    .eq('id', member.pair_id)
    .maybeSingle();
  return pair ? { member, pair } : null;
}

async function consumeRateLimit(req: Request, action: string, limit: number) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const keyHash = await sha256(`${ip}:${action}`);
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

async function createPair(req: Request) {
  if (!await consumeRateLimit(req, 'create', 8)) return json(429, { error: 'too_many_requests' });
  const memberToken = randomToken();
  const tokenHash = await sha256(memberToken);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inviteCode = randomText(6);
    const inviteHash = await sha256(inviteCode);
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const { data: pair, error } = await supabase.from('friend_pairs').insert({
      challenge_date: seoulDate(), invite_hash: inviteHash, invite_expires_at: expiresAt,
    }).select('id').single();
    if (error?.code === '23505') continue;
    if (error || !pair) return json(500, { error: 'create_failed' });
    const { error: memberError } = await supabase.from('friend_members').insert({
      pair_id: pair.id, slot: 1, token_hash: tokenHash, status: 'active',
    });
    if (memberError) { await supabase.from('friend_pairs').delete().eq('id', pair.id); return json(500, { error: 'create_failed' }); }
    return json(200, { pairId: pair.id, inviteCode, inviteExpiresAt: expiresAt, memberToken, slot: 1, status: 'waiting' });
  }
  return json(503, { error: 'code_unavailable' });
}

async function joinPair(req: Request, body: Record<string, unknown>) {
  if (!await consumeRateLimit(req, 'join', 10)) return json(429, { error: 'too_many_requests' });
  const inviteCode = String(body.inviteCode ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (inviteCode.length !== 6) return json(400, { error: 'invalid_code' });
  const inviteHash = await sha256(inviteCode);
  const { data: pair } = await supabase.from('friend_pairs').select('id,status,invite_expires_at,challenge_date')
    .eq('invite_hash', inviteHash).eq('status', 'waiting').maybeSingle();
  if (!pair || pair.challenge_date !== seoulDate() || new Date(pair.invite_expires_at).getTime() <= Date.now()) {
    return json(404, { error: 'code_not_found' });
  }
  const { count } = await supabase.from('friend_members').select('id', { count: 'exact', head: true }).eq('pair_id', pair.id);
  if ((count ?? 0) >= 2) return json(409, { error: 'pair_full' });
  const memberToken = randomToken();
  const { error } = await supabase.from('friend_members').insert({
    pair_id: pair.id, slot: 2, token_hash: await sha256(memberToken), status: 'pending',
  });
  if (error) return json(error.code === '23505' ? 409 : 500, { error: error.code === '23505' ? 'pair_full' : 'join_failed' });
  return json(200, { pairId: pair.id, memberToken, slot: 2, status: 'pending' });
}

async function state(req: Request) {
  const auth = await authenticate(req);
  if (!auth) return json(401, { error: 'unauthorized' });
  const { member, pair } = auth;
  if (member.status === 'pending') return json(200, { pairId: pair.id, slot: member.slot, status: 'pending', photos: [] });
  const { data: members } = await supabase.from('friend_members').select('slot,status').eq('pair_id', pair.id);
  const { data: photos } = await supabase.from('friend_photos').select('owner_slot,version,deleted_at').eq('pair_id', pair.id);
  return json(200, {
    pairId: pair.id,
    slot: member.slot,
    status: pair.status,
    pendingJoin: member.slot === 1 && members?.some((item) => item.slot === 2 && item.status === 'pending'),
    photos: (photos ?? []).map((photo) => ({ slot: photo.owner_slot, version: photo.version, available: !photo.deleted_at })),
  });
}

async function approve(req: Request) {
  const auth = await authenticate(req);
  if (!auth || auth.member.slot !== 1 || auth.member.status !== 'active' || auth.pair.status !== 'waiting') {
    return json(403, { error: 'forbidden' });
  }
  const { data, error } = await supabase.rpc('approve_friend_join', {
    p_pair_id: auth.pair.id, p_expected_version: auth.pair.version,
  });
  if (error) return json(500, { error: 'approve_failed' });
  if (data !== true) return json(409, { error: 'state_changed' });
  return json(200, { status: 'active' });
}

async function uploadPhoto(req: Request) {
  const auth = await authenticate(req);
  if (!auth || auth.member.status !== 'active' || auth.pair.status !== 'active') return json(403, { error: 'forbidden' });
  const form = await req.formData();
  const file = form.get('file');
  const expectedVersion = Number(form.get('expectedVersion') ?? 0);
  if (!(file instanceof File) || file.type !== 'image/jpeg' || file.size < 100 || file.size > 5_242_880 || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    return json(400, { error: 'invalid_photo' });
  }
  const original = new Uint8Array(await file.arrayBuffer());
  const dimensions = jpegDimensions(original);
  if (!dimensions || dimensions.width < 320 || dimensions.height < 320 || dimensions.width > 4096 || dimensions.height > 4096) {
    return json(400, { error: 'invalid_photo' });
  }
  let sanitized: Uint8Array;
  try { sanitized = stripJpegMetadata(original); } catch { return json(400, { error: 'invalid_photo' }); }
  const newKey = `${auth.pair.id}/${auth.member.slot}/${crypto.randomUUID()}.jpg`;
  const { error: uploadError } = await supabase.storage.from('friend-photos').upload(newKey, sanitized, { contentType: 'image/jpeg', upsert: false });
  if (uploadError) return json(500, { error: 'upload_failed' });
  const { data, error } = await supabase.rpc('replace_friend_photo', {
    p_pair_id: auth.pair.id, p_owner_slot: auth.member.slot, p_expected_version: expectedVersion, p_new_object_key: newKey,
  });
  if (error) { await supabase.storage.from('friend-photos').remove([newKey]); return json(409, { error: 'version_conflict' }); }
  const result = data?.[0];
  if (result?.old_object_key) await supabase.storage.from('friend-photos').remove([result.old_object_key]);
  return json(200, { version: result?.new_version });
}

async function deletePhoto(req: Request, body: Record<string, unknown>) {
  const auth = await authenticate(req);
  if (!auth || auth.member.status !== 'active' || auth.pair.status !== 'active') return json(403, { error: 'forbidden' });
  const expectedVersion = Number(body.expectedVersion ?? -1);
  const { data, error } = await supabase.rpc('delete_friend_photo', {
    p_pair_id: auth.pair.id, p_owner_slot: auth.member.slot, p_expected_version: expectedVersion,
  });
  if (error) return json(409, { error: 'version_conflict' });
  const oldKey = data?.[0]?.old_object_key;
  if (oldKey) await supabase.storage.from('friend-photos').remove([oldKey]);
  return json(200, { version: data?.[0]?.new_version });
}

async function photo(req: Request, url: URL) {
  const auth = await authenticate(req);
  if (!auth || auth.member.status !== 'active' || auth.pair.status !== 'active') return json(403, { error: 'forbidden' });
  const slot = Number(url.searchParams.get('slot'));
  if (slot !== 1 && slot !== 2) return json(400, { error: 'invalid_slot' });
  const { data: item } = await supabase.from('friend_photos').select('object_key,deleted_at').eq('pair_id', auth.pair.id).eq('owner_slot', slot).maybeSingle();
  if (!item?.object_key || item.deleted_at) return json(404, { error: 'photo_not_found' });
  const { data, error } = await supabase.storage.from('friend-photos').download(item.object_key);
  if (error || !data) return json(404, { error: 'photo_not_found' });
  return new Response(await data.arrayBuffer(), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action') ?? '';
    if (req.method === 'GET' && action === 'state') return await state(req);
    if (req.method === 'GET' && action === 'photo') return await photo(req, url);
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    if (action === 'create') return await createPair(req);
    if (action === 'upload') return await uploadPhoto(req);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (action === 'join') return await joinPair(req, body);
    if (action === 'approve') return await approve(req);
    if (action === 'delete') return await deletePhoto(req, body);
    return json(404, { error: 'unknown_action' });
  } catch {
    return json(500, { error: 'server_error' });
  }
});
