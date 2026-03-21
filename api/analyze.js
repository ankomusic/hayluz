// /api/analyze — POST — AI analysis via OpenRouter
module.exports = async function handler(req, res) {
  // Diagnostic log — remove after confirming fix
  console.log('[analyze] method:', req.method, '| body type:', typeof req.body, '| body:', JSON.stringify(req.body)?.slice(0, 100));

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Parse body — handle both parsed object and raw string
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  body = body || {};

  const { prompt, systemPrompt } = body;

  console.log('[analyze] prompt exists:', !!prompt, '| key exists:', !!process.env.OPENROUTER_API_KEY);

  if (!prompt) return res.status(400).json({ error: 'Prompt required' });

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });

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
        max_tokens: 1024,
        messages: [
          { role: 'system', content: systemPrompt || 'Eres un experto en el sistema eléctrico de Maracaibo, Venezuela. Responde en español.' },
          { role: 'user', content: prompt }
        ]
      })
    });
    if (!r.ok) {
      const txt = await r.text();
      console.error('[analyze] OpenRouter error:', r.status, txt.slice(0, 200));
      return res.status(r.status).json({ error: txt });
    }
    const data = await r.json();
    console.log('[analyze] success, model response length:', data.choices?.[0]?.message?.content?.length);
    return res.status(200).json({ result: data.choices?.[0]?.message?.content || '' });
  } catch (e) {
    console.error('[analyze] exception:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
