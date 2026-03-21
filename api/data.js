// /api/data — GET: sector data | POST: AI analysis & verify
// All AI calls go through this single proven endpoint
// Env: OPENROUTER_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, TWITTER_BEARER_TOKEN

const PARROQUIAS = [
  "Coquivacoa","Urdaneta","Idelfonso Vásquez","Venancio Pulgar","Juana de Ávila",
  "Olegario Villalobos","Bolívar","Santa Lucía","Chiquinquirá",
  "Caracciolo Parra Pérez","Raúl Leoni","Cacique Mara","Cecilio Acosta",
  "Antonio Borjas Romero","San Isidro","Francisco Eugenio Bustamante",
  "Manuel Dagnino","Cristo de Aranza","Luis Hurtado Higuera"
];

async function callOpenRouter(system, user, maxTokens = 1024) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY not configured');
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'HTTP-Referer': 'https://hayluz.vercel.app',
      'X-Title': 'Hay Luz?'
    },
    body: JSON.stringify({
      model: 'google/gemini-2.0-flash-001',
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    })
  });
  if (!r.ok) throw new Error(await r.text());
  const d = await r.json();
  return d.choices?.[0]?.message?.content || '';
}

async function handleAnalyze(body) {
  const { prompt, systemPrompt } = body;
  if (!prompt) return { status: 400, body: { error: 'Prompt required' } };
  const result = await callOpenRouter(
    systemPrompt || 'Eres un experto en el sistema eléctrico de Maracaibo, Venezuela. Responde en español.',
    prompt
  );
  return { status: 200, body: { result } };
}

async function handleVerify(body) {
  const { report } = body;
  if (!report) return { status: 400, body: { error: 'Report required' } };
  const system = `Verificas reportes de cortes eléctricos en Maracaibo, Venezuela.
Devuelve SOLO JSON válido sin markdown:
{"score":0-100,"verdict":"Verificado|Probable|Dudoso|Falso","confidence":"Alta|Media|Baja","indicators":{"hasLocation":bool,"hasTime":bool,"hasSource":bool,"hasDetails":bool,"consistentWithGrid":bool},"flags":["..."],"summary":"..."}`;
  const text = await callOpenRouter(system, `Verifica: "${report}"`, 512);
  try {
    return { status: 200, body: JSON.parse(text.replace(/```json|```/g, '').trim()) };
  } catch {
    return { status: 200, body: { error: 'Parse error', raw: text } };
  }
}

async function handleReport(body) {
  const { parroquia, status, cause, reporterNote } = body;
  if (!parroquia || !status) return { status: 400, body: { error: 'parroquia and status required' } };
  if (!['ok','inter','cut'].includes(status)) return { status: 400, body: { error: 'invalid status' } };

  let confidence = 'high';
  if (process.env.OPENROUTER_API_KEY && reporterNote) {
    try {
      const t = await callOpenRouter(
        'Responde SOLO JSON: {"confidence":"high"|"medium"|"low"}',
        `¿Reporte creíble? Parroquia:${parroquia} Estado:${status} Nota:${reporterNote}`, 80
      );
      confidence = JSON.parse(t.replace(/```json|```/g,'')).confidence || 'medium';
    } catch { confidence = 'medium'; }
  }
  if (confidence === 'low') return { status: 422, body: { error: 'Reporte no pasó validación', confidence } };

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (url && key) {
    const since = status === 'ok' ? '—' : new Date().toLocaleTimeString('es-VE', { hour:'2-digit', minute:'2-digit', timeZone: 'America/Caracas' });
    const ins = await fetch(`${url}/rest/v1/outages?on_conflict=parroquia`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', apikey: key, Authorization:`Bearer ${key}`, Prefer:'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ parroquia, status, cause: cause||'—', hours: status==='ok'?0:1, since, affected:0, reporter_note: reporterNote||null, confidence, updated_at: new Date().toISOString() })
    });
    if (!ins.ok) return { status: 500, body: { error: 'DB write failed' } };
  }
  return { status: 200, body: { ok: true, confidence } };
}

async function handleGet(res) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  let sectors = null, source = 'fallback';

  if (url && key) {
    try {
      const r = await fetch(`${url}/rest/v1/outages?select=parroquia,status,hours,since,cause,affected,updated_at&order=updated_at.desc&limit=200`,
        { headers: { apikey: key, Authorization:`Bearer ${key}`, Accept:'application/json' } });
      if (r.ok) {
        const rows = await r.json();
        if (Array.isArray(rows) && rows.length) {
          const seen = new Map();
          for (const row of rows) if (row.parroquia && !seen.has(row.parroquia)) seen.set(row.parroquia, row);
          sectors = PARROQUIAS.map(name => {
            const row = seen.get(name);
            if (!row) return { name, status:'nodata', hours:0, since:'—', cause:'—', affected:0 };
            return { name, status:['ok','inter','cut'].includes(row.status)?row.status:'ok', hours:Number(row.hours)||0, since:row.since||'—', cause:row.cause||'—', affected:Number(row.affected)||0 };
          });
          source = 'supabase';
        }
      }
    } catch(e) { console.error('Supabase:', e.message); }
  }

  if (!sectors) sectors = PARROQUIAS.map(n => ({ name:n, status:'nodata', hours:0, since:'—', cause:'—', affected:0 }));

  res.setHeader('Cache-Control', 's-maxage=25, stale-while-revalidate=5');
  return res.status(200).json({ sectors, source, fetchedAt: new Date().toISOString(), city: 'Maracaibo' });
}

async function handleGetReports() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return { status: 200, body: { reports: [] } };
  try {
    const r = await fetch(
      `${url}/rest/v1/outages?select=parroquia,status,cause,reporter_note,updated_at&order=updated_at.desc&limit=20`,
      { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' } }
    );
    if (!r.ok) return { status: 200, body: { reports: [] } };
    const rows = await r.json();
    return { status: 200, body: { reports: Array.isArray(rows) ? rows : [] } };
  } catch {
    return { status: 200, body: { reports: [] } };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') return handleGet(res);

  if (req.method === 'POST') {
    const body = req.body || {};
    const { action } = body;
    try {
      let result;
      if (action === 'analyze') result = await handleAnalyze(body);
      else if (action === 'verify') result = await handleVerify(body);
      else if (action === 'report') result = await handleReport(body);
      else if (action === 'reports') result = await handleGetReports();
      else result = { status: 400, body: { error: 'action required: analyze|verify|report' } };
      return res.status(result.status).json(result.body);
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
