// language: JavaScript, file: api/count.js, runtime: Node.js Vercel Serverless, target: Vercel / cross-platform
// Global state via Vercel KV (if configured) or ntfy.sh persistent pub/sub cache so all computers share the exact same number.

const DEFAULT_TOPIC = process.env.COUNTER_TOPIC || 'diogo_rt_counter_global_v2';
let fallbackCount = 0;

async function redisCommand(command, ...args) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const endpoint = `${url}/${[command, ...args].map(encodeURIComponent).join('/')}`;
  const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  return data.result;
}

async function getNtfyCount(topic) {
  try {
    const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}/json?poll=1`, {
      headers: { 'Cache-Control': 'no-cache' }
    });
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.trim().split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const evt = JSON.parse(lines[i]);
        if (evt.event === 'message' && evt.message) {
          const payload = JSON.parse(evt.message);
          if (typeof payload.count === 'number' && Number.isFinite(payload.count)) {
            return payload.count;
          }
        }
      } catch {}
    }
  } catch {}
  return null;
}

async function setNtfyCount(topic, count) {
  try {
    await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: 'POST',
      body: JSON.stringify({ count, ts: Date.now() })
    });
  } catch {}
}

function parseBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    if (typeof req.body === 'string') {
      try { return resolve(JSON.parse(req.body)); } catch { return resolve({}); }
    }
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const room = (urlObj.searchParams.get('room') || 'global').replace(/[^a-zA-Z0-9_-]/g, '');
  const topic = `${DEFAULT_TOPIC}_${room}`;
  const kvKey = `counter_${room}`;

  const hasRedis = Boolean(
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) ||
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  );

  if (req.method === 'GET') {
    if (hasRedis) {
      const val = await redisCommand('GET', kvKey);
      return res.status(200).json({ count: Number(val) || 0, topic });
    }
    const cloudVal = await getNtfyCount(topic);
    if (cloudVal !== null) fallbackCount = cloudVal;
    return res.status(200).json({ count: fallbackCount, topic });
  }

  if (req.method === 'POST') {
    const body = await parseBody(req);
    const hasExplicitValue = typeof body.value === 'number' && Number.isFinite(body.value);
    const delta = typeof body.delta === 'number' && Number.isFinite(body.delta) ? body.delta : 1;

    if (hasRedis) {
      let nextVal;
      if (hasExplicitValue) {
        nextVal = Math.trunc(body.value);
        await redisCommand('SET', kvKey, String(nextVal));
      } else {
        nextVal = Number(await redisCommand('INCRBY', kvKey, String(Math.trunc(delta))));
      }
      await setNtfyCount(topic, nextVal);
      return res.status(200).json({ count: nextVal, topic });
    }

    const currentCloud = await getNtfyCount(topic);
    const base = currentCloud !== null ? currentCloud : fallbackCount;
    const nextVal = hasExplicitValue ? Math.trunc(body.value) : base + Math.trunc(delta);
    fallbackCount = nextVal;
    await setNtfyCount(topic, nextVal);
    return res.status(200).json({ count: nextVal, topic });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
