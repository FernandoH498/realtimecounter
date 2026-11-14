// Vercel Serverless Function: GET /api/count and POST /api/count
// Integrates with Vercel KV / Upstash Redis if env vars exist; falls back to in-memory for testing.

let memoryCount = 0;

async function redisCommand(command, ...args) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const endpoint = `${url}/${[command, ...args].map(encodeURIComponent).join('/')}`;
  const res = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  return data.result;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const hasRedis = Boolean(
    (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) ||
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
  );

  if (req.method === 'POST') {
    if (hasRedis) {
      const val = await redisCommand('INCR', 'global_counter');
      return res.status(200).json({ count: Number(val) });
    }
    memoryCount += 1;
    return res.status(200).json({ count: memoryCount });
  }

  if (req.method === 'GET') {
    if (hasRedis) {
      const val = await redisCommand('GET', 'global_counter');
      return res.status(200).json({ count: Number(val) || 0 });
    }
    return res.status(200).json({ count: memoryCount });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
