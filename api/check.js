module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { report } = req.body || {};
  if (!report) return res.status(400).json({ error: 'Report required' });

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });

  const system = `Verificas reportes de cortes eléctricos en Maracaibo, Venezuela.
Devuelve SOLO JSON válido sin markdown:
{"score":0-100,"verdict":"Verificado|Probable|Dudoso|Falso","confidence":"Alta|Media|Baja","indicators":{"hasLocation":bool,"hasTime":bool,"hasSource":bool,"hasDetails":bool,"consistentWithGrid":bool},"flags":["..."],"summary":"..."}`;

  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        'HTTP-Referer': 'https://hayluz.vercel.app',
        'X-Title': 'Hay Luz?'
      },
      body: JSON.stringify({
        model: 'google/gemini-flash-1.5',
        max_tokens: 512,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Verifica: "${report}"` }
        ]
      })
    });
    if (!r.ok) return res.status(r.status).json({ error: 'OpenRouter error' });
    const data = await r.json();
    const text = data.choices?.[0]?.message?.content || '{}';
    try {
      return res.status(200).json(JSON.parse(text.replace(/```json|```/g, '').trim()));
    } catch {
      return res.status(200).json({ error: 'Parse error', raw: text });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
