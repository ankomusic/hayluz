// /api/report — POST — Community outage report → validate with AI → save to Supabase
// Env: OPENROUTER_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { parroquia, status, cause, reporterNote } = req.body || {};
  if (!parroquia || !status) return res.status(400).json({ error: 'parroquia and status required' });
  if (!['ok', 'inter', 'cut'].includes(status)) return res.status(400).json({ error: 'status must be ok|inter|cut' });

  const key = process.env.OPENROUTER_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  let confidence = 'high';
  if (key && reporterNote) {
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'HTTP-Referer': 'https://hayluz.vercel.app', 'X-Title': 'Hay Luz?' },
        body: JSON.stringify({
          model: 'google/gemini-flash-1.5', max_tokens: 80,
          messages: [
            { role: 'system', content: 'Responde SOLO JSON: {"confidence":"high"|"medium"|"low"}' },
            { role: 'user', content: `¿Reporte creíble? Parroquia:${parroquia} Estado:${status} Nota:${reporterNote}` }
          ]
        })
      });
      if (r.ok) {
        const d = await r.json();
        const t = d.choices?.[0]?.message?.content || '{}';
        const p = JSON.parse(t.replace(/```json|```/g, '').trim());
        confidence = p.confidence || 'medium';
      }
    } catch { /* proceed */ }
  }

  if (confidence === 'low') return res.status(422).json({ error: 'Reporte no pasó validación', confidence });

  if (supabaseUrl && serviceKey) {
    const since = status === 'ok' ? '—' : new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
    const ins = await fetch(`${supabaseUrl}/rest/v1/outages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}`, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ parroquia, status, cause: cause || '—', hours: status === 'ok' ? 0 : 1, since, affected: 0, reporter_note: reporterNote || null, confidence, updated_at: new Date().toISOString() })
    });
    if (!ins.ok) return res.status(500).json({ error: 'DB write failed', detail: await ins.text() });
  }
  return res.status(200).json({ ok: true, confidence });
};
