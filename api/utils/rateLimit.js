const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 5;

async function getSupabaseHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Prefer': 'return=representation'
  };
}

async function upsertRateLimit(ip, increment = true) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  
  try {
    const now = Date.now();
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rate_limits?ip=eq.${encodeURIComponent(ip)}&order=updated_at.desc&limit=1`, {
      headers: await getSupabaseHeaders()
    });
    
    if (!r.ok) return null;
    
    const rows = await r.json();
    let entry = rows?.[0];
    
    if (!entry || (now - new Date(entry.updated_at).getTime()) > WINDOW_MS) {
      const createRes = await fetch(`${SUPABASE_URL}/rest/v1/rate_limits`, {
        method: 'POST',
        headers: { ...await getSupabaseHeaders(), 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({
          ip,
          count: 1,
          updated_at: new Date().toISOString()
        })
      });
      if (createRes.ok) return { count: 1, allowed: true };
      return null;
    }
    
    const newCount = increment ? entry.count + 1 : 1;
    const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/rate_limits?ip=eq.${encodeURIComponent(ip)}`, {
      method: 'PATCH',
      headers: { ...await getSupabaseHeaders(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        count: newCount,
        updated_at: new Date().toISOString()
      })
    });
    
    return {
      count: newCount,
      allowed: newCount <= MAX_REQUESTS
    };
  } catch {
    return null;
  }
}

async function checkRateLimit(ip) {
  const result = await upsertRateLimit(ip);
  if (result === null) return { allowed: true, fallback: true };
  return { allowed: result.allowed, count: result.count, fallback: false };
}

function getClientIP(req) {
  return req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
    req?.headers?.['x-real-ip'] ||
    req?.socket?.remoteAddress ||
    'unknown';
}

module.exports = { checkRateLimit, getClientIP, MAX_REQUESTS, WINDOW_MS };
