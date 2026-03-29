const { setCorsHeaders, apiError, apiSuccess } = require('../utils/helpers');

const MAX_FAILS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const LOGIN_RATE_LIMIT = 10;
const LOGIN_WINDOW_MS = 60 * 1000;

const loginFails = new Map();
const loginAttempts = new Map();

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
}

function checkLoginRateLimit(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, first: now };
  if (now - record.first > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, first: now });
    return true;
  }
  if (record.count >= LOGIN_RATE_LIMIT) {return false;}
  record.count++;
  loginAttempts.set(ip, record);
  return true;
}

function checkLockout(ip) {
  const failRecord = loginFails.get(ip);
  if (!failRecord) {return null;}
  
  const lockedUntil = failRecord.lockedUntil || 0;
  if (Date.now() < lockedUntil) {
    return {
      minutesLeft: Math.ceil((lockedUntil - Date.now()) / 60000),
      lockedUntil
    };
  }
  loginFails.delete(ip);
  return null;
}

function recordFailedLogin(ip) {
  const fails = loginFails.get(ip) || { count: 0 };
  fails.count++;
  fails.lastFail = Date.now();
  if (fails.count >= MAX_FAILS) {
    fails.lockedUntil = Date.now() + LOCKOUT_MS;
  }
  loginFails.set(ip, fails);
  return {
    count: fails.count,
    lockedUntil: fails.lockedUntil,
    attemptsLeft: MAX_FAILS - fails.count
  };
}

function clearFailedLogin(ip) {
  loginFails.delete(ip);
}

module.exports = async function handler(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {return res.status(200).end();}

  const ip = getClientIP(req);
  
  if (!checkLoginRateLimit(ip)) {
    return res.status(429).json(apiError(429, 'Too many requests - wait a minute'));
  }

  const expectedSecret = process.env.ADMIN_SECRET;
  if (!expectedSecret) {
    return res.status(500).json(apiError(500, 'ADMIN_SECRET not configured'));
  }
  
  const secret = req.headers['x-admin-secret'];

  const lockout = checkLockout(ip);
  if (lockout) {
    return res.status(429).json(apiError(429, `Demasiados intentos fallidos. Bloqueado por ${lockout.minutesLeft} min más.`, {
      lockedUntil: lockout.lockedUntil,
      minutesLeft: lockout.minutesLeft,
      retryAfter: lockout.minutesLeft * 60
    }));
  }

  if (!secret || secret !== expectedSecret) {
    const fail = recordFailedLogin(ip);
    if (fail.lockedUntil) {
      return res.status(429).json(apiError(429, `Demasiados intentos fallidos. Bloqueado por ${LOCKOUT_MS / 60000} minutos.`, {
        lockedUntil: fail.lockedUntil,
        retryAfter: Math.ceil(LOCKOUT_MS / 1000)
      }));
    }
    return res.status(401).json(apiError(401, 'Contraseña incorrecta', {
      attemptsLeft: fail.attemptsLeft
    }));
  }

  clearFailedLogin(ip);

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    return res.status(500).json(apiError(500, 'Supabase not configured'));
  }

  const headers = {
    'Content-Type': 'application/json',
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Prefer': 'return=representation'
  };

  try {
    if (req.method === 'GET') {
      const limit = Math.min(parseInt(req.query?.limit) || 100, 200);
      const r = await fetch(`${url}/rest/v1/outages?select=*&order=updated_at.desc&limit=${limit}`, { headers });
      const data = await r.json();
      return res.status(r.status).json(Array.isArray(data) ? data : []);
    }

    if (req.method === 'POST') {
      const { parroquia, status, hours, since, cause, affected } = req.body || {};
      
      if (!parroquia || !status) {
        return res.status(400).json(apiError(400, 'parroquia and status required'));
      }
      if (!['ok','inter','cut'].includes(status)) {
        return res.status(400).json(apiError(400, 'invalid status'));
      }

      const r = await fetch(`${url}/rest/v1/outages?on_conflict=parroquia`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
          parroquia,
          status,
          hours: Number(hours) || 0,
          since: since || (status === 'ok' ? '—' : new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Caracas' })),
          cause: (cause || '—').slice(0, 500),
          affected: Number(affected) || 0,
          confidence: 'high',
          source: 'admin',
          updated_at: new Date().toISOString()
        })
      });
      if (!r.ok) {
        return res.status(r.status).json(apiError(r.status, 'Database error', { detail: await r.text() }));
      }
      return res.status(200).json(apiSuccess({ ok: true, action: 'upsert', parroquia }));
    }

    if (req.method === 'DELETE') {
      const { parroquia } = req.body || {};
      if (!parroquia) {
        return res.status(400).json(apiError(400, 'parroquia required'));
      }
      const r = await fetch(`${url}/rest/v1/outages?parroquia=eq.${encodeURIComponent(parroquia)}`, {
        method: 'DELETE',
        headers
      });
      if (!r.ok) {
        return res.status(r.status).json(apiError(r.status, 'Delete failed', { detail: await r.text() }));
      }
      return res.status(200).json(apiSuccess({ ok: true, action: 'delete', deletedParroquia: parroquia }));
    }

    return res.status(405).json(apiError(405, 'Method not allowed'));
  } catch (e) {
    console.error('[admin/v1] exception:', e.message);
    return res.status(500).json(apiError(500, 'Internal server error', { detail: e.message }));
  }
};
