module.exports = async function handler(req, res) {
  console.log('[analyze] INVOKED — method:', req.method);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Respond 200 to EVERYTHING — diagnostic only
  return res.status(200).json({ ok: true, method: req.method, received: true });
};
