// /api/data — GET — Sector status from Supabase → Twitter+AI → fallback
// Env: OPENROUTER_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, TWITTER_BEARER_TOKEN
const PARROQUIAS = [
  "Coquivacoa","Urdaneta","Idelfonso Vásquez","Venancio Pulgar","Juana de Ávila",
  "Olegario Villalobos","Bolívar","Santa Lucía","Chiquinquirá",
  "Caracciolo Parra Pérez","Raúl Leoni","Cacique Mara","Cecilio Acosta",
  "Antonio Borjas Romero","San Isidro","Francisco Eugenio Bustamante",
  "Manuel Dagnino","Cristo de Aranza","Luis Hurtado Higuera"
];

async function callOpenRouter(system, user) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'HTTP-Referer': 'https://hayluz.vercel.app', 'X-Title': 'Hay Luz?' },
    body: JSON.stringify({ model: 'google/gemini-flash-1.5', max_tokens: 1500, temperature: 0.1, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
  });
  if (!r.ok) return null;
  return ((await r.json()).choices?.[0]?.message?.content) || null;
}

async function fetchFromSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const r = await fetch(`${url}/rest/v1/outages?select=parroquia,status,hours,since,cause,affected,updated_at&order=updated_at.desc&limit=200`,
      { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' } });
    if (!r.ok) { console.error('Supabase', r.status, await r.text()); return null; }
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) return null;
    const seen = new Map();
    for (const row of rows) if (row.parroquia && !seen.has(row.parroquia)) seen.set(row.parroquia, row);
    return PARROQUIAS.map(name => {
      const row = seen.get(name);
      if (!row) return { name, status: 'ok', hours: 0, since: '—', cause: '—', affected: 0 };
      return { name, status: ['ok','inter','cut'].includes(row.status) ? row.status : 'ok', hours: Number(row.hours)||0, since: row.since||'—', cause: row.cause||'—', affected: Number(row.affected)||0, updatedAt: row.updated_at };
    });
  } catch (e) { console.error('Supabase exception:', e.message); return null; }
}

async function fetchTwitter() {
  const token = process.env.TWITTER_BEARER_TOKEN;
  if (!token) return [];
  const q = encodeURIComponent('(corpoelec OR "sin luz" OR "corte electrico") (maracaibo OR zulia) lang:es -is:retweet');
  try {
    const r = await fetch(`https://api.twitter.com/2/tweets/search/recent?query=${q}&max_results=20&tweet.fields=text`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return [];
    return ((await r.json()).data || []).map(t => t.text).slice(0, 10);
  } catch { return []; }
}

async function parseWithAI(tweets) {
  if (!tweets.length) return null;
  const text = await callOpenRouter(
    'Eres analista eléctrico. Responde SOLO JSON sin markdown.',
    `Tweets sobre cortes en Maracaibo:\n${tweets.map((t,i)=>`${i+1}. ${t}`).join('\n')}\n\nParroquias: ${PARROQUIAS.join(', ')}\n\nDevuelve: [{"name":"...","status":"cut|inter|ok","hours":0,"since":"HH:MM o —","cause":"...","affected":0}]`
  );
  if (!text) return null;
  try { return JSON.parse(text.replace(/```json|```/g, '').trim()); } catch { return null; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  let sectors = await fetchFromSupabase();
  let source = sectors ? 'supabase' : 'fallback';

  if (!sectors) {
    const tweets = await fetchTwitter();
    const parsed = await parseWithAI(tweets);
    if (parsed?.length) { sectors = parsed; source = 'twitter+ai'; }
  }

  if (!sectors) sectors = PARROQUIAS.map(n => ({ name: n, status: 'ok', hours: 0, since: '—', cause: '—', affected: 0 }));
  return res.status(200).json({ sectors, source, fetchedAt: new Date().toISOString(), city: 'Maracaibo' });
};
