const KNOWN_SOURCES = [
  'corpoelec.gob.ve',
  'twitter.com/corpoelec',
  'x.com/corpoelec',
  '@corpoelec',
  'ministerio de energía',
  'gobierno del zulia',
  'alcaldía de maracaibo',
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { report } = req.body;
  if (!report) return res.status(400).json({ error: 'Report content is required' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const systemPrompt = `Eres un verificador de autenticidad de reportes sobre cortes eléctricos en Maracaibo, Venezuela. 
Tu tarea es analizar si un reporte parece legítimo y confiable.

Evalúa estos criterios y devuelve SOLO un JSON válido con esta estructura exacta:
{
  "score": <número 0-100>,
  "verdict": "<Verificado|Probable|Dudoso|Falso>",
  "confidence": "<Alta|Media|Baja>",
  "indicators": {
    "hasLocation": <true|false>,
    "hasTime": <true|false>,
    "hasSource": <true|false>,
    "hasDetails": <true|false>,
    "consistentWithGrid": <true|false>
  },
  "flags": ["<lista de señales de alerta si las hay>"],
  "summary": "<Una oración explicando el veredicto>"
}

Criterios de evaluación:
- Menciona sector o zona específica de Maracaibo (hasLocation)
- Incluye hora o duración aproximada (hasTime) 
- Cita fuente (Corpoelec, vecinos, redes sociales, etc.) (hasSource)
- Tiene detalles técnicos o contextuales creíbles (hasDetails)
- Es consistente con patrones conocidos del sistema eléctrico venezolano (consistentWithGrid)
- Señales de alerta: exageración extrema, números imposibles, contenido político desproporcionado, información contradictoria

Score: 80-100 = Verificado, 60-79 = Probable, 40-59 = Dudoso, 0-39 = Falso`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: 'user', content: `Verifica este reporte de corte eléctrico:\n\n"${report}"` }]
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.error?.message });
    }

    const data = await response.json();
    const text = data.content?.map(b => b.text || '').join('') || '{}';

    try {
      const clean = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      return res.status(200).json(parsed);
    } catch {
      return res.status(200).json({ error: 'Could not parse AI response', raw: text });
    }
  } catch (e) {
    return res.status(500).json({ error: 'Internal server error: ' + e.message });
  }
}
