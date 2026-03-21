// /api/admin — GET/POST/DELETE — Protected admin operations
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_SECRET

// Rate limiter — max 10 requests por IP por minuto
const attempts = new Map();

// Login lockout — max 5 intentos fallidos → bloqueo 15 minutos
const loginFails = new Map();
const MAX_FAILS    = 5;
const LOCKOUT_MS   = 15 * 60 * 1000;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Rate limiting general
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  const now = Date.now();
  const record = attempts.get(ip) || { count: 0, first: now };
  if (now - record.first > 60000) { record.count = 0; record.first = now; }
  record.count++;
  attempts.set(ip, record);
  if (record.count > 10) return res.status(429).json({ error: 'Too many requests — wait a minute' });

  // Auth — fail closed if ADMIN_SECRET not configured
  const expectedSecret = process.env.ADMIN_SECRET;
  if (!expectedSecret) return res.status(500).json({ error: 'ADMIN_SECRET not configured' });
  const secret = req.headers['x-admin-secret'];

  // Check lockout before validating password
  const failRecord = loginFails.get(ip);
  if (failRecord) {
    const lockedUntil = failRecord.lockedUntil || 0;
    if (now < lockedUntil) {
      const minutesLeft = Math.ceil((lockedUntil - now) / 60000);
      return res.status(429).json({
        error: `Demasiados intentos fallidos. Bloqueado por ${minutesLeft} min más.`,
        lockedUntil,
        minutesLeft
      });
    }
    // Lockout expired — reset
    if (now >= lockedUntil && failRecord.lockedUntil) loginFails.delete(ip);
  }

  if (!secret || secret !== expectedSecret) {
    // Register failed attempt
    const fails = loginFails.get(ip) || { count: 0 };
    fails.count++;
    fails.lastFail = now;
    if (fails.count >= MAX_FAILS) {
      fails.lockedUntil = now + LOCKOUT_MS;
      loginFails.set(ip, fails);
      return res.status(429).json({
        error: `Demasiados intentos fallidos. Bloqueado por ${LOCKOUT_MS / 60000} minutos.`,
        lockedUntil: fails.lockedUntil
      });
    }
    loginFails.set(ip, fails);
    return res.status(401).json({
      error: 'Contraseña incorrecta',
      attemptsLeft: MAX_FAILS - fails.count
    });
  }

  // Successful login — clear fail record
  loginFails.delete(ip);

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return res.status(500).json({ error: 'Supabase not configured' });

  const headers = {
    'Content-Type': 'application/json',
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Prefer': 'return=representation'
  };

  try {
    if (req.method === 'GET') {
      const r = await fetch(`${url}/rest/v1/outages?select=*&order=updated_at.desc&limit=100`, { headers });
      return res.status(r.status).json(await r.json());
    }

    if (req.method === 'POST') {
      const { parroquia, status, hours, since, cause, affected } = req.body || {};
      if (!parroquia || !status) return res.status(400).json({ error: 'parroquia and status required' });
      const r = await fetch(`${url}/rest/v1/outages?on_conflict=parroquia`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          parroquia, status,
          hours: Number(hours) || 0,
          since: since || (status === 'ok' ? '—' : new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' })),
          cause: cause || '—',
          affected: Number(affected) || 0,
          confidence: 'high',
          source: 'admin',
          updated_at: new Date().toISOString()
        })
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
  } catch (e) {
    console.error('[admin] exception:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
