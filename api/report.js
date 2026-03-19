/**
 * /api/report  — POST
 * Receives a community outage report, validates it with Claude,
 * and writes it to Supabase if confidence is high enough.
 *
 * Body: { parroquia, status, cause, reporterNote }
 * Env:  ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const { parroquia, status, cause, reporterNote } = req.body || {};
  if (!parroquia || !status) return res.status(400).json({ error: 'parroquia and status required' });

  const apiKey     = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY; // use service key for writes

  // Optional: validate with Claude before writing
  let confidence = 'high';
  if (apiKey && reporterNote) {
    try {
      const cr = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 100,
          system: 'Responde solo con JSON: {"confidence": "high"|"medium"|"low", "reason": "..."}',
          messages: [{ role: 'user', content: `¿Es este reporte de corte eléctrico creíble? Parroquia: ${parroquia}. Estado: ${status}. Nota: ${reporterNote}` }]
        })
      });
      const cd = await cr.json();
      const ct = cd.content?.[0]?.text || '{}';
      const cp = JSON.parse(ct.replace(/```json|```/g, '').trim());
      confidence = cp.confidence || 'medium';
    } catch { /* proceed without validation */ }
  }

  if (confidence === 'low') {
    return res.status(422).json({ error: 'Reporte no pasó validación de confianza', confidence });
  }

  // Write to Supabase
  if (supabaseUrl && serviceKey) {
    const now = new Date().toISOString();
    const hours = status === 'ok' ? 0 : 1; // default 1h if no time info
    const since = status === 'ok' ? '—' : new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });

    const insert = await fetch(`${supabaseUrl}/rest/v1/outages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        parroquia, status, cause: cause || '—',
        hours, since, affected: 0,
        reporter_note: reporterNote || null,
        confidence, updated_at: now
      })
    });

    if (!insert.ok) {
      const err = await insert.text();
      return res.status(500).json({ error: 'DB write failed', detail: err });
    }
  }

  return res.status(200).json({ ok: true, confidence });
}
