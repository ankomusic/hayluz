const { checkRateLimit, getClientIP, MAX_REQUESTS } = require('../utils/rateLimit');
const { sanitizePrompt, sanitizeJSONResponse, callOpenRouterWithRetry, setCorsHeaders, apiError, apiSuccess } = require('../utils/helpers');

const PARROQUIAS = [
  'Venancio Pulgar','Idelfonso Vásquez','Coquivacoa','Juana de Ávila',
  'San Isidro','Antonio Borjas Romero','Caracciolo Parra Pérez','Olegario Villalobos',
  'Chiquinquirá','Raúl Leoni','Francisco Eugenio Bustamante','Cacique Mara',
  'Santa Lucía','Bolívar','Cecilio Acosta','Cristo de Aranza',
  'Manuel Dagnino','Luis Hurtado Higuera'
];

async function handleAnalyze(body) {
  const { prompt, systemPrompt } = body;
  if (!prompt) {return { status: 400, body: apiError(400, 'Prompt required') };}
  
  const sanitizedPrompt = sanitizePrompt(prompt);
  const sanitizedSystem = systemPrompt ? sanitizePrompt(systemPrompt) : null;
  
  try {
    const result = await callOpenRouterWithRetry(
      sanitizedSystem || 'Eres un experto en el sistema eléctrico de Maracaibo, Venezuela. Responde en español.',
      sanitizedPrompt
    );
    return { status: 200, body: apiSuccess({ result }) };
  } catch (err) {
    return { status: 503, body: apiError(503, 'AI service temporarily unavailable', { retry: true }) };
  }
}

async function handleVerify(body) {
  const { report } = body;
  if (!report) {return { status: 400, body: apiError(400, 'Report required') };}
  
  const sanitizedReport = sanitizePrompt(report);
  const system = `Verificas reportes de cortes eléctricos en Maracaibo, Venezuela.
Devuelve SOLO JSON válido sin markdown:
{"score":0-100,"verdict":"Verificado|Probable|Dudoso|Falso","confidence":"Alta|Media|Baja","indicators":{"hasLocation":bool,"hasTime":bool,"hasSource":bool,"hasDetails":bool,"consistentWithGrid":bool},"flags":["..."],"summary":"..."}`;
  
  try {
    const text = await callOpenRouterWithRetry(system, `Verifica: "${sanitizedReport}"`, 512);
    const parsed = sanitizeJSONResponse(text);
    try {
      return { status: 200, body: apiSuccess(JSON.parse(parsed)) };
    } catch {
      return { status: 200, body: apiSuccess({ raw: parsed, parsed: false }) };
    }
  } catch (err) {
    return { status: 503, body: apiError(503, 'Verification service unavailable') };
  }
}

async function handleReport(req, body) {
  const ip = getClientIP(req);
  const { allowed, count, fallback } = await checkRateLimit(ip);
  
  if (!allowed) {
    const retryAfter = Math.ceil((10 * 60 * 1000) / 1000);
    return {
      status: 429,
      body: apiError(429, 'Demasiados reportes. Espera 10 minutos.', {
        retryAfter,
        limit: MAX_REQUESTS,
        fallback
      })
    };
  }

  const { parroquia, status, cause, reporterNote } = body;

  if (!parroquia || !status) {
    return { status: 400, body: apiError(400, 'parroquia and status required') };
  }
  if (!['ok','inter','cut'].includes(status)) {
    return { status: 400, body: apiError(400, 'invalid status - must be ok, inter, or cut') };
  }
  if (!PARROQUIAS.includes(parroquia)) {
    return { status: 400, body: apiError(400, `Invalid parroquia - must be one of: ${PARROQUIAS.join(', ')}`) };
  }

  let confidence = 'high';
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  
  if (process.env.OPENROUTER_API_KEY && reporterNote) {
    try {
      const sanitizedNote = sanitizePrompt(reporterNote);
      const t = await callOpenRouterWithRetry(
        'Responde SOLO JSON: {"confidence":"high"|"medium"|"low"}',
        `¿Reporte creíble? Parroquia:${parroquia} Estado:${status} Nota:${sanitizedNote}`, 80
      );
      const parsed = JSON.parse(sanitizeJSONResponse(t));
      confidence = parsed.confidence || 'medium';
    } catch { confidence = 'medium'; }
  }
  if (confidence === 'low') {
    return { status: 422, body: apiError(422, 'Reporte no pasó validación', { confidence }) };
  }

  if (url && key) {
    const since = status === 'ok' ? '—' : new Date().toLocaleTimeString('es-VE', { hour:'2-digit', minute:'2-digit', timeZone: 'America/Caracas' });
    const sanitizedCause = cause ? sanitizePrompt(cause).slice(0, 500) : '—';
    const sanitizedNote = reporterNote ? sanitizePrompt(reporterNote).slice(0, 1000) : null;
    
    const ins = await fetch(`${url}/rest/v1/outages?on_conflict=parroquia`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', apikey: key, Authorization:`Bearer ${key}`, Prefer:'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        parroquia,
        status,
        cause: sanitizedCause,
        hours: status === 'ok' ? 0 : 1,
        since,
        affected: 0,
        reporter_note: sanitizedNote,
        confidence,
        updated_at: new Date().toISOString()
      })
    });
    if (!ins.ok) {
      return { status: 500, body: apiError(500, 'DB write failed', { detail: await ins.text() }) };
    }
  }
  
  return { status: 200, body: apiSuccess({ ok: true, confidence, reportsRemaining: MAX_REQUESTS - (count || 1) }) };
}

async function handleGet(res, query) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  const limit = Math.min(parseInt(query?.limit) || 200, 200);
  let sectors = null, source = 'fallback';

  if (url && key) {
    try {
      const r = await fetch(
        `${url}/rest/v1/outages?select=parroquia,status,hours,since,cause,affected,updated_at&order=updated_at.desc&limit=${limit}`,
        { headers: { apikey: key, Authorization:`Bearer ${key}`, Accept:'application/json' } }
      );
      if (r.ok) {
        const rows = await r.json();
        if (Array.isArray(rows) && rows.length) {
          const seen = new Map();
          for (const row of rows) {if (row.parroquia && !seen.has(row.parroquia)) {seen.set(row.parroquia, row);}}
          sectors = PARROQUIAS.map((name) => {
            const row = seen.get(name);
            if (!row) {return { name, status:'nodata', hours:0, since:'—', cause:'—', affected:0 };}
            return {
              name,
              status: ['ok','inter','cut'].includes(row.status) ? row.status : 'ok',
              hours: Number(row.hours) || 0,
              since: row.since || '—',
              cause: row.cause || '—',
              affected: Number(row.affected) || 0
            };
          });
          source = 'supabase';
        }
      }
    } catch(e) { console.error('Supabase:', e.message); }
  }

  if (!sectors) {sectors = PARROQUIAS.map((n) => ({ name:n, status:'nodata', hours:0, since:'—', cause:'—', affected:0 }));}

  res.setHeader('Cache-Control', 's-maxage=25, stale-while-revalidate=5');
  return res.status(200).json({ sectors, source, fetchedAt: new Date().toISOString(), city: 'Maracaibo', apiVersion: 'v1' });
}

async function handleGetReports(query) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  const limit = Math.min(parseInt(query?.limit) || 20, 50);
  
  if (!url || !key) {return { status: 200, body: apiSuccess({ reports: [] }) };}
  
  try {
    const r = await fetch(
      `${url}/rest/v1/outages?select=parroquia,status,cause,reporter_note,updated_at&order=updated_at.desc&limit=${limit}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' } }
    );
    if (!r.ok) {return { status: 200, body: apiSuccess({ reports: [] }) };}
    const rows = await r.json();
    return { status: 200, body: apiSuccess({ reports: Array.isArray(rows) ? rows : [] }) };
  } catch {
    return { status: 200, body: apiSuccess({ reports: [] }) };
  }
}

module.exports = async function handler(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {return res.status(200).end();}

  if (req.method === 'GET') {
    const result = await handleGet(res, req.query);
    return res.status(result.status).json(result.body);
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const { action } = body;
    try {
      let result;
      if (action === 'analyze') {result = await handleAnalyze(body);}
      else if (action === 'verify') {result = await handleVerify(body);}
      else if (action === 'report') {result = await handleReport(req, body);}
      else if (action === 'reports') {result = await handleGetReports(body);}
      else {result = { status: 400, body: apiError(400, 'action required: analyze|verify|report|reports') };}
      return res.status(result.status).json(result.body);
    } catch(e) {
      return res.status(500).json(apiError(500, 'Internal server error', { detail: e.message }));
    }
  }

  return res.status(405).json(apiError(405, 'Method not allowed'));
};
