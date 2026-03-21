// Simple in-memory rate limit (resets con cada cold start)
const attempts = new Map();
const ip = req.headers['x-forwarded-for'] || 'unknown';
const now = Date.now();
const record = attempts.get(ip) || { count: 0, first: now };
if (now - record.first > 60000) { record.count = 0; record.first = now; }
if (record.count > 10) return res.status(429).json({ error: 'Too many attempts' });
record.count++;
attempts.set(ip, record);

// /api/admin — GET/POST/DELETE — Protected admin operations
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_SECRET
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth — fail closed if ADMIN_SECRET not configured
  const expectedSecret = process.env.ADMIN_SECRET;
  if (!expectedSecret) return res.status(500).json({ error: 'ADMIN_SECRET not configured' });
  const secret = req.headers['x-admin-secret'];
  if (!secret || secret !== expectedSecret) return res.status(401).json({ error: 'Unauthorized' });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return res.status(500).json({ error: 'Supabase not configured' });

  const headers = { 'Content-Type': 'application/json', 'apikey': key, 'Authorization': `Bearer ${key}`, 'Prefer': 'return=representation' };

  if (req.method === 'GET') {
    const r = await fetch(`${url}/rest/v1/outages?select=*&order=updated_at.desc&limit=100`, { headers });
    return res.status(r.status).json(await r.json());
  }

  if (req.method === 'POST') {
    const { parroquia, status, hours, since, cause, affected } = req.body || {};
    if (!parroquia || !status) return res.status(400).json({ error: 'parroquia and status required' });
    const r = await fetch(`${url}/rest/v1/outages`, {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ parroquia, status, hours: Number(hours)||0, since: since||(status==='ok'?'—':new Date().toLocaleTimeString('es-VE',{hour:'2-digit',minute:'2-digit'})), cause: cause||'—', affected: Number(affected)||0, confidence: 'high', updated_at: new Date().toISOString() })
    });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { parroquia } = req.body || {};
    if (!parroquia) return res.status(400).json({ error: 'parroquia required' });
    const r = await fetch(`${url}/rest/v1/outages?parroquia=eq.${encodeURIComponent(parroquia)}`, { method: 'DELETE', headers });
    return res.status(r.ok ? 200 : r.status).json(r.ok ? { ok: true } : { error: await r.text() });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
