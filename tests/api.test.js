import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_ANON_KEY;
delete process.env.SUPABASE_SERVICE_KEY;
delete process.env.ADMIN_SECRET;
delete process.env.OPENROUTER_API_KEY;

const require = createRequire(import.meta.url);
const {
  apiError,
  apiSuccess,
  sanitizeJSONResponse,
  sanitizePrompt
} = require('../api/utils/helpers');
const { PARROQUIAS } = require('../api/utils/constants');
const dataHandler = require('../api/data');
const v1DataHandler = require('../api/v1/data');
const adminHandler = require('../api/admin');

function createResponse() {
  const res = {
    body: undefined,
    headers: {},
    sent: false,
    statusCode: 200,
    setHeader: vi.fn((key, value) => {
      res.headers[key.toLowerCase()] = value;
      return res;
    }),
    status: vi.fn((code) => {
      res.statusCode = code;
      return res;
    }),
    json: vi.fn((body) => {
      if (res.sent) throw new Error('Response sent twice');
      res.sent = true;
      res.body = body;
      return res;
    }),
    end: vi.fn(() => {
      if (res.sent) throw new Error('Response sent twice');
      res.sent = true;
      return res;
    })
  };

  return res;
}

function createRequest({ method = 'GET', body = {}, query = {}, headers = {}, ip = '127.0.0.1' } = {}) {
  return {
    body,
    headers: {
      'x-forwarded-for': ip,
      ...headers
    },
    method,
    query,
    socket: { remoteAddress: ip }
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.ADMIN_SECRET;
  delete process.env.OPENROUTER_API_KEY;
});

describe('helpers', () => {
  it('sanitizes script tags, dangerous protocols, handlers, controls, and length', () => {
    const input = `Hello\x00<script>
alert("xss")
</script><a onclick="alert(1)" href="javascript:doEvil()">world</a>${'a'.repeat(3000)}`;
    const result = sanitizePrompt(input);

    expect(result).not.toContain('<script>');
    expect(result).not.toContain('javascript:');
    expect(result).not.toContain('onclick');
    expect(result).not.toContain('\x00');
    expect(result.length).toBeLessThanOrEqual(2000);
  });

  it('returns an empty string for non-string prompt input', () => {
    expect(sanitizePrompt(null)).toBe('');
    expect(sanitizePrompt(undefined)).toBe('');
    expect(sanitizePrompt(123)).toBe('');
  });

  it('unwraps fenced JSON responses', () => {
    expect(sanitizeJSONResponse('```json\n{"ok":true}\n```')).toBe('{"ok":true}');
    expect(sanitizeJSONResponse('```\n{"ok":true}\n```')).toBe('{"ok":true}');
  });

  it('formats API success and error payloads consistently', () => {
    const error = apiError(400, 'Test error', { field: 'value' });
    const success = apiSuccess({ ok: true, count: 5 });

    expect(error).toMatchObject({
      apiVersion: 'v1',
      details: { field: 'value' },
      error: true,
      message: 'Test error',
      status: 400
    });
    expect(success).toMatchObject({
      apiVersion: 'v1',
      count: 5,
      ok: true,
      success: true
    });
  });
});

describe('public data API', () => {
  it('returns fallback sector data once for GET requests', async () => {
    const res = createResponse();

    await dataHandler(createRequest(), res);

    expect(res.statusCode).toBe(200);
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.body.sectors).toHaveLength(PARROQUIAS.length);
    expect(res.body.source).toBe('fallback');
    expect(res.headers['cache-control']).toContain('s-maxage=25');
  });

  it('keeps the versioned GET endpoint aligned with the root endpoint', async () => {
    const res = createResponse();

    await v1DataHandler(createRequest(), res);

    expect(res.statusCode).toBe(200);
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.body.sectors).toHaveLength(PARROQUIAS.length);
    expect(res.body.apiVersion).toBe('v1');
  });

  it('rejects unknown POST actions', async () => {
    const res = createResponse();

    await dataHandler(createRequest({ method: 'POST', body: { action: 'bogus' } }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      error: true,
      message: 'action required: analyze|verify|report|reports'
    });
  });

  it('rejects invalid report payloads before writing', async () => {
    const res = createResponse();

    await dataHandler(createRequest({
      method: 'POST',
      body: { action: 'report', parroquia: 'No existe', status: 'ok' },
      ip: 'report-invalid'
    }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain('Invalid parroquia');
  });

  it('accepts a valid report even when persistence is not configured', async () => {
    const res = createResponse();

    await dataHandler(createRequest({
      method: 'POST',
      body: { action: 'report', parroquia: PARROQUIAS[0], status: 'ok' },
      ip: 'report-valid'
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      confidence: 'high',
      ok: true,
      reportsRemaining: 4,
      success: true
    });
  });
});

describe('admin API', () => {
  it('returns lockout metadata under details for failed logins', async () => {
    process.env.ADMIN_SECRET = 'expected';
    const res = createResponse();

    await adminHandler(createRequest({
      headers: { 'x-admin-secret': 'wrong' },
      ip: 'admin-wrong-secret'
    }), res);

    expect(res.statusCode).toBe(401);
    expect(res.body.details).toMatchObject({ attemptsLeft: 4 });
  });

  it('rejects unknown parroquias before calling Supabase', async () => {
    process.env.ADMIN_SECRET = 'expected';
    process.env.SUPABASE_URL = 'https://supabase.example.test';
    process.env.SUPABASE_SERVICE_KEY = 'service-key';

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = createResponse();

    await adminHandler(createRequest({
      method: 'POST',
      body: { parroquia: 'No existe', status: 'ok' },
      headers: { 'x-admin-secret': 'expected' },
      ip: 'admin-invalid-parroquia'
    }), res);

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('invalid parroquia');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
