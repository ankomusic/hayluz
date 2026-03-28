const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 500;
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_RESET_MS = 60 * 1000;

let circuitState = { failures: 0, openUntil: 0 };

function sanitizePrompt(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/<script[^>]*>.*?<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim()
    .slice(0, 2000);
}

function sanitizeJSONResponse(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/```json|```/g, '').trim();
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryWithBackoff(fn, retries = MAX_RETRIES) {
  let lastError;
  
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < retries) {
        const delay = INITIAL_DELAY_MS * Math.pow(2, i);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

function isCircuitOpen() {
  if (circuitState.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    if (Date.now() < circuitState.openUntil) {
      return true;
    }
    circuitState.failures = 0;
    circuitState.openUntil = 0;
  }
  return false;
}

function recordFailure() {
  circuitState.failures++;
  if (circuitState.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitState.openUntil = Date.now() + CIRCUIT_BREAKER_RESET_MS;
  }
}

function recordSuccess() {
  circuitState.failures = Math.max(0, circuitState.failures - 1);
}

async function callOpenRouterWithRetry(system, user, maxTokens = 1024) {
  if (isCircuitOpen()) {
    throw new Error('Circuit breaker open - AI service temporarily unavailable');
  }
  
  try {
    const result = await retryWithBackoff(async () => {
      return await callOpenRouter(system, user, maxTokens);
    });
    recordSuccess();
    return result;
  } catch (err) {
    recordFailure();
    throw err;
  }
}

async function callOpenRouter(system, user, maxTokens = 1024) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY not configured');
  
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'HTTP-Referer': process.env.ALLOWED_ORIGIN || 'https://hayluz.vercel.app',
      'X-Title': 'Hay Luz?'
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-001',
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

function getAllowedOrigin() {
  return process.env.ALLOWED_ORIGIN || '*';
}

function setCorsHeaders(res, origin = '*') {
  const allowedOrigin = getAllowedOrigin();
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-secret');
}

function apiError(status, message, details = null) {
  return {
    error: true,
    status,
    message,
    ...(details && { details }),
    timestamp: new Date().toISOString(),
    apiVersion: 'v1'
  };
}

function apiSuccess(data) {
  return {
    success: true,
    ...data,
    timestamp: new Date().toISOString(),
    apiVersion: 'v1'
  };
}

module.exports = {
  sanitizePrompt,
  sanitizeJSONResponse,
  retryWithBackoff,
  isCircuitOpen,
  callOpenRouter,
  callOpenRouterWithRetry,
  getAllowedOrigin,
  setCorsHeaders,
  apiError,
  apiSuccess,
  MAX_RETRIES,
  CIRCUIT_BREAKER_THRESHOLD,
  CIRCUIT_BREAKER_RESET_MS
};
