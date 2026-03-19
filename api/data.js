/**
 * /api/data
 * Aggregates real outage data for Hay Luz?
 *
 * Sources (in priority order):
 *   1. Supabase (your own DB — populated via admin panel or community reports)
 *   2. Twitter/X API v2 — scrapes @corpoelec and hashtags
 *   3. Claude AI — parses raw tweets into structured sector data
 *
 * Environment variables needed in Vercel:
 *   ANTHROPIC_API_KEY   — Claude API key
 *   SUPABASE_URL        — https://xxxx.supabase.co
 *   SUPABASE_ANON_KEY   — public anon key from Supabase dashboard
 *   TWITTER_BEARER_TOKEN — Bearer token from developer.twitter.com (optional)
 */

const PARROQUIAS = [
  "Coquivacoa","Urdaneta","Olegario Villalobos","Bolívar","Chiquinquirá",
  "Santa Lucía","Cristo de Aranza","Cecilio Acosta","Francisco Eugenio Bustamante",
  "Juana de Ávila","Manuel Dagnino","Antonio Borjas Romero","Raúl Leoni",
  "Luis Hurtado Higuera","San Isidro","Caracciolo Parra Pérez","Venancio Pulgar","El Cuji"
];

// ─────────────────────────────────────────────
// SOURCE 1: Supabase — your own controlled DB
// ─────────────────────────────────────────────
async function fetchFromSupabase() {
  const url  = process.env.SUPABASE_URL;
  const key  = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  try {
    // Fetch latest status per parroquia (updated_at DESC, one row per parroquia)
    const res = await fetch(
      `${url}/rest/v1/outages?select=parroquia,status,hours,since,cause,affected,updated_at&order=updated_at.desc`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!res.ok) return null;
    const rows = await res.json();

    // Deduplicate — keep latest row per parroquia
    const seen = new Map();
    for (const row of rows) {
      if (!seen.has(row.parroquia)) seen.set(row.parroquia, row);
    }

    return PARROQUIAS.map(name => {
      const row = seen.get(name);
      if (!row) return { name, status: 'ok', hours: 0, since: '—', cause: '—', affected: 0 };
      return {
        name,
        status:   row.status   || 'ok',
        hours:    row.hours    || 0,
        since:    row.since    || '—',
        cause:    row.cause    || '—',
        affected: row.affected || 0,
        updatedAt: row.updated_at,
      };
    });
  } catch { return null; }
}

// ─────────────────────────────────────────────
// SOURCE 2: Twitter/X API v2 — recent tweets
// ─────────────────────────────────────────────
async function fetchTwitterTweets() {
  const token = process.env.TWITTER_BEARER_TOKEN;
  if (!token) return [];

  // Search for corte eléctrico mentions in Maracaibo
  const query = encodeURIComponent(
    '(corpoelec OR "sin luz" OR "corte electrico" OR "falla electrica") (maracaibo OR zulia) lang:es -is:retweet'
  );

  try {
    const res = await fetch(
      `https://api.twitter.com/2/tweets/search/recent?query=${query}&max_results=20&tweet.fields=created_at,text`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || []).map(t => t.text).slice(0, 10);
  } catch { return []; }
}

// ─────────────────────────────────────────────
// SOURCE 3: Claude AI — parse tweets → sectors
// ─────────────────────────────────────────────
async function parseWithClaude(tweets, apiKey) {
  if (!tweets.length) return null;

  const parroquiaList = PARROQUIAS.join(', ');
  const tweetText = tweets.map((t, i) => `${i+1}. ${t}`).join('\n');

  const prompt = `Analiza estos tweets recientes sobre el sistema eléctrico en Maracaibo, Venezuela:

${tweetText}

Las parroquias de Maracaibo son: ${parroquiaList}

Para cada parroquia mencionada, determina si hay corte (cut), intermitencia (inter) o servicio normal (ok).
Si no hay información de una parroquia, asume "ok".

Responde SOLO con JSON válido, sin markdown, con este formato exacto:
[
  {"name": "Nombre Parroquia", "status": "cut|inter|ok", "hours": 0, "since": "HH:MM o —", "cause": "descripción breve o —", "affected": 0-100}
]`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: 'Eres un analizador de datos de cortes eléctricos en Venezuela. Responde SOLO con JSON válido, sin texto adicional, sin markdown.',
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data.content?.map(b => b.text || '').join('') || '[]';
    const cleaned = text.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch { return null; }
}

// ─────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60'); // cache 2 min

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  let sectors = null;
  let source  = 'fallback';

  // Priority 1: Supabase
  sectors = await fetchFromSupabase();
  if (sectors) { source = 'supabase'; }

  // Priority 2: Twitter + Claude parse
  if (!sectors && apiKey) {
    const tweets = await fetchTwitterTweets();
    if (tweets.length) {
      const parsed = await parseWithClaude(tweets, apiKey);
      if (parsed?.length) {
        sectors = parsed;
        source  = 'twitter+claude';
      }
    }
  }

  // Priority 3: Static fallback (demo data)
  if (!sectors) {
    sectors = PARROQUIAS.map(name => ({
      name, status: 'ok', hours: 0, since: '—', cause: '—', affected: 0
    }));
    source = 'fallback';
  }

  return res.status(200).json({
    sectors,
    source,
    fetchedAt: new Date().toISOString(),
    city: 'Maracaibo',
  });
}
