/**
 * Cloudflare Pages Function — /api/signal
 * WebRTC signaling relay via KV.
 */

const PEER_TTL_MS = 30_000;
const MESSAGE_TTL_SEC = 120;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function roomPeersKey(room) {
  return `signal:${room}:peers`;
}

function roomMessagePrefix(room, peerId) {
  return `signal:${room}:msg:${peerId}:`;
}

async function loadPeers(env, room) {
  const raw = await env.FSM_KV.get(roomPeersKey(room));
  return raw ? JSON.parse(raw) : {};
}

async function savePeers(env, room, peers) {
  await env.FSM_KV.put(roomPeersKey(room), JSON.stringify(peers), { expirationTtl: MESSAGE_TTL_SEC });
}

function prunePeers(peers) {
  const now = Date.now();
  return Object.fromEntries(
    Object.entries(peers).filter(([, ts]) => now - Number(ts) < PEER_TTL_MS),
  );
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const room = url.searchParams.get('room');
    const peerId = url.searchParams.get('peer');
    if (!room || !peerId) return json({ error: 'Missing room or peer' }, 400);

    const peers = prunePeers(await loadPeers(env, room));
    peers[peerId] = Date.now();
    await savePeers(env, room, peers);

    const prefix = roomMessagePrefix(room, peerId);
    const listed = await env.FSM_KV.list({ prefix });
    const messages = [];
    for (const key of listed.keys) {
      const raw = await env.FSM_KV.get(key.name);
      if (raw) messages.push(JSON.parse(raw));
      await env.FSM_KV.delete(key.name);
    }

    return json({
      peers: Object.keys(peers).filter(id => id !== peerId),
      messages,
    });
  }

  if (request.method === 'POST') {
    const body = await request.json();
    const { room, kind, peerId, targetId, signal } = body || {};
    if (!room || !kind || !peerId) return json({ error: 'Missing fields' }, 400);

    if (kind === 'register') {
      const peers = prunePeers(await loadPeers(env, room));
      peers[peerId] = Date.now();
      await savePeers(env, room, peers);
      return json({ ok: true, peers: Object.keys(peers).filter(id => id !== peerId) });
    }

    if (kind === 'leave') {
      const peers = prunePeers(await loadPeers(env, room));
      delete peers[peerId];
      await savePeers(env, room, peers);
      return json({ ok: true });
    }

    if (kind === 'signal') {
      if (!targetId || !signal) return json({ error: 'Missing targetId or signal' }, 400);
      const key = `${roomMessagePrefix(room, targetId)}${crypto.randomUUID()}`;
      await env.FSM_KV.put(key, JSON.stringify({
        from: peerId,
        signal,
        createdAt: Date.now(),
      }), { expirationTtl: MESSAGE_TTL_SEC });
      return json({ ok: true });
    }
  }

  return json({ error: 'Method not allowed' }, 405);
}
