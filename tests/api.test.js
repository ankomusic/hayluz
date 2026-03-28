import { describe, it, expect, beforeEach } from 'vitest';

describe('Sanitize prompt', () => {
  const sanitizePrompt = (input) => {
    if (typeof input !== 'string') return '';
    return input
      .replace(/[\x00-\x1F\x7F]/g, '')
      .replace(/<script[^>]*>.*?<\/script>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '')
      .trim()
      .slice(0, 2000);
  };

  it('removes script tags', () => {
    const input = 'Hello <script>alert("xss")</script> world';
    expect(sanitizePrompt(input)).toBe('Hello  world');
  });

  it('removes javascript: protocol', () => {
    const input = 'Click here: javascript:doEvil()';
    expect(sanitizePrompt(input)).not.toContain('javascript:');
  });

  it('removes event handlers', () => {
    const input = 'Test onclick="alert(1)" content';
    expect(sanitizePrompt(input)).not.toContain('onclick');
  });

  it('removes control characters', () => {
    const input = 'Hello\x00World\x1F';
    expect(sanitizePrompt(input)).toBe('HelloWorld');
  });

  it('limits length to 2000 chars', () => {
    const input = 'a'.repeat(3000);
    expect(sanitizePrompt(input).length).toBe(2000);
  });

  it('returns empty string for non-string input', () => {
    expect(sanitizePrompt(null)).toBe('');
    expect(sanitizePrompt(undefined)).toBe('');
    expect(sanitizePrompt(123)).toBe('');
  });

  it('handles empty string', () => {
    expect(sanitizePrompt('')).toBe('');
  });
});

describe('API Error Response Format', () => {
  const apiError = (status, message, details = null) => ({
    error: true,
    status,
    message,
    ...(details && { details }),
    timestamp: expect.any(String),
    apiVersion: 'v1'
  });

  const apiSuccess = (data) => ({
    success: true,
    ...data,
    timestamp: expect.any(String),
    apiVersion: 'v1'
  });

  it('creates error response with all fields', () => {
    const result = apiError(400, 'Test error', { field: 'value' });
    expect(result.error).toBe(true);
    expect(result.status).toBe(400);
    expect(result.message).toBe('Test error');
    expect(result.details.field).toBe('value');
    expect(result.apiVersion).toBe('v1');
  });

  it('creates error response without details', () => {
    const result = apiError(404, 'Not found');
    expect(result.error).toBe(true);
    expect(result.details).toBeUndefined();
  });

  it('creates success response', () => {
    const result = apiSuccess({ ok: true, count: 5 });
    expect(result.success).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(5);
    expect(result.apiVersion).toBe('v1');
  });
});

describe('Rate Limit Logic', () => {
  it('allows requests within limit', () => {
    const MAX_REQUESTS = 5;
    const WINDOW_MS = 10 * 60 * 1000;
    const map = new Map();
    const now = Date.now();

    const check = (ip) => {
      const entry = map.get(ip) || { count: 0, start: now };
      if (now - entry.start > WINDOW_MS) {
        map.set(ip, { count: 1, start: now });
        return true;
      }
      if (entry.count >= MAX_REQUESTS) return false;
      entry.count++;
      map.set(ip, entry);
      return true;
    };

    for (let i = 0; i < 5; i++) {
      expect(check('test-ip')).toBe(true);
    }
    expect(check('test-ip')).toBe(false);
  });

  it('resets after window expires', async () => {
    const MAX_REQUESTS = 2;
    const WINDOW_MS = 100;
    const map = new Map();
    let now = 1000;

    const check = (ip) => {
      const entry = map.get(ip) || { count: 0, start: now };
      if (now - entry.start > WINDOW_MS) {
        map.set(ip, { count: 1, start: now });
        return true;
      }
      if (entry.count >= MAX_REQUESTS) return false;
      entry.count++;
      map.set(ip, entry);
      return true;
    };

    expect(check('ip1')).toBe(true);
    expect(check('ip1')).toBe(true);
    expect(check('ip1')).toBe(false);

    now = 1200;
    expect(check('ip1')).toBe(true);
  });
});

describe('Status validation', () => {
  const validStatuses = ['ok', 'inter', 'cut'];

  it('accepts valid statuses', () => {
    validStatuses.forEach(status => {
      expect(validStatuses.includes(status)).toBe(true);
    });
  });

  it('rejects invalid statuses', () => {
    expect(validStatuses.includes('invalid')).toBe(false);
    expect(validStatuses.includes('')).toBe(false);
    expect(validStatuses.includes('OK')).toBe(false);
  });
});

describe('Parroquias validation', () => {
  const PARROQUIAS = [
    "Venancio Pulgar","Idelfonso Vásquez","Coquivacoa","Juana de Ávila",
    "San Isidro","Antonio Borjas Romero","Caracciolo Parra Pérez","Olegario Villalobos",
    "Chiquinquirá","Raúl Leoni","Francisco Eugenio Bustamante","Cacique Mara",
    "Santa Lucía","Bolívar","Cecilio Acosta","Cristo de Aranza",
    "Manuel Dagnino","Luis Hurtado Higuera"
  ];

  it('has 18 parroquias', () => {
    expect(PARROQUIAS.length).toBe(18);
  });

  it('contains expected parroquias', () => {
    expect(PARROQUIAS).toContain('Coquivacoa');
    expect(PARROQUIAS).toContain('Luis Hurtado Higuera');
  });

  it('rejects invalid parroquia', () => {
    expect(PARROQUIAS.includes('Invalid Parroquia')).toBe(false);
  });

  it('parroquias are unique', () => {
    const unique = new Set(PARROQUIAS);
    expect(unique.size).toBe(PARROQUIAS.length);
  });
});

describe('Circuit Breaker', () => {
  it('opens after threshold failures', () => {
    const THRESHOLD = 5;
    let failures = 0;

    const isOpen = () => failures >= THRESHOLD;

    for (let i = 0; i < 4; i++) {
      failures++;
      expect(isOpen()).toBe(false);
    }

    failures++;
    expect(isOpen()).toBe(true);
  });

  it('records failures correctly', () => {
    const THRESHOLD = 3;
    let failures = 0;
    const recordedFailures = [];

    for (let i = 0; i < 5; i++) {
      failures++;
      recordedFailures.push(failures);
    }

    expect(recordedFailures[2]).toBe(3);
    expect(recordedFailures[3]).toBe(4);
    expect(recordedFailures[4]).toBe(5);
  });
});
