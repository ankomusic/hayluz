module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { prompt, systemPrompt } = req.body || {};
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
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    const data = await r.json();
    return res.status(200).json({ result: data.choices?.[0]?.message?.content || '' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
