/**
 * Cloudflare Pages Function — /api/fsm
 * GET  /api/fsm?id=<uuid>  → FSM JSON をKVから取得
 * PUT  /api/fsm?id=<uuid>  → FSM JSON をKVに保存（30日TTL）
 */
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (!id) return new Response('Missing id', { status: 400 });

  const kvKey = `fsm:${id}`;

  if (request.method === 'GET') {
    const value = await env.FSM_KV.get(kvKey);
    if (value === null) return new Response(null, { status: 404 });
    return new Response(value, {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (request.method === 'PUT') {
    const body = await request.text();
    await env.FSM_KV.put(kvKey, body, { expirationTtl: 2592000 }); // 30日
    return new Response('ok');
  }

  return new Response('Method not allowed', { status: 405 });
}
