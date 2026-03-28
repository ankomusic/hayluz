# Hay Luz?

Monitor de cortes eléctricos en tiempo real por parroquia para Maracaibo, Zulia. Construido con HTML/CSS/JS puro, Vercel serverless, Supabase como base de datos y OpenRouter como gateway de IA.

---

## Estructura del proyecto

```
hayluz/
├── api/
│   ├── data.js           # Endpoint legacy (v0 deprecated)
│   ├── admin.js          # Admin legacy
│   ├── v1/
│   │   ├── data.js      # API v1 — GET/POST con rate limiting persistente
│   │   └── admin.js     # Admin v1
│   └── utils/
│       ├── rateLimit.js # Rate limiter con Supabase
│       └── helpers.js   # Sanitización, retry, circuit breaker, helpers
├── public/
│   ├── index.html        # App completa (frontend)
│   ├── admin.html       # Panel de administración
│   ├── manifest.json    # PWA manifest
│   ├── sw.js            # Service worker
│   └── icons/
├── tests/               # Tests Vitest
├── supabase-updates.sql # Migración de schema + RLS mejorado
├── vercel.json         # Headers CORS, rewrite /admin, API v1
├── .eslintrc.json      # ESLint config
├── prettier.config.json # Prettier config
└── package.json        # Node 20.x
```

---

## Funcionalidades

- **Monitor por parroquia** — 18 parroquias del Municipio Maracaibo con estado en tiempo real. Las parroquias con información real se priorizan sobre las que no tienen datos.
- **Estados** — Corte activo / Intermitente / Estable / Sin info (nodata cuando no hay fila en Supabase)
- **Mapa interactivo** — Polígonos georreferenciados sobre OpenStreetMap con colores dinámicos por estado
- **Análisis IA** — Diagnóstico del sistema eléctrico vía OpenRouter (Gemini 2.0 Flash)
- **Verificador de autenticidad** — Evalúa reportes con score 0-100 y veredicto (Verificado/Probable/Dudoso/Falso)
- **Reportes comunitarios** — Formulario validado por IA, guardado en Supabase con upsert por parroquia
- **Feed de reportes** — Lee las últimas 20 filas de Supabase en tiempo real
- **Actualización automática** — Refresco cada 30 segundos, caché del servidor de 25s
- **Panel de administración** — Interfaz protegida en `/admin`
- **PWA** — Instalable en móvil, funciona offline, service worker v3
- **Modo oscuro/claro** — Toggle con persistencia visual
- **Zona horaria** — Toda hora mostrada en America/Caracas (UTC-4)
- **Rate limiting persistente** — Límite de reportes por IP almacenado en Supabase (no en memoria)
- **Retry con circuit breaker** — Reintentos automáticos con backoff exponencial para llamadas IA
- **Sanitización de prompts** — Protección contra XSS y prompt injection
- **API versionada** — Endpoint `/api/v1/` con formato de respuestas estandarizado
- **OpenTelemetry** — Telemetría integrada para monitoreo de rendimiento
- **Tests** — Suite de tests con Vitest

---

## Variables de entorno (Vercel)

| Variable | Requerida | Descripción |
|---|---|---|
| `OPENROUTER_API_KEY` | ✅ | API key de openrouter.ai |
| `SUPABASE_URL` | ✅ | `https://xxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | ✅ | Clave pública — lectura |
| `SUPABASE_SERVICE_KEY` | ✅ | Clave privada — escritura |
| `ADMIN_SECRET` | ✅ | Contraseña del panel `/admin` |
| `ALLOWED_ORIGIN` | ⬜ | Dominio para CORS (default: *) |
| `OPENROUTER_MODEL` | ⬜ | Modelo de IA (default: google/gemini-2.0-flash-001) |
| `TWITTER_BEARER_TOKEN` | ⬜ | Scraping automático de tweets (opcional) |

---

## Configuración de Vercel (dashboard)

En **Settings → General → Build & Development Settings**:
- **Build Command:** `echo ok`
- **Output Directory:** `public`
- **Node.js Version:** `20.x`

El `vercel.json` solo contiene headers y un rewrite — no usa `builds` ni `outputDirectory`.

---

## Supabase — tabla outages

```sql
CREATE TABLE outages (
  id            BIGSERIAL PRIMARY KEY,
  parroquia     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'ok',   -- ok | inter | cut
  hours         INTEGER DEFAULT 0,
  since         TEXT DEFAULT '—',
  cause         TEXT DEFAULT '—',
  affected      INTEGER DEFAULT 0,
  reporter_note TEXT,
  confidence    TEXT DEFAULT 'high',
  source        TEXT DEFAULT 'community',
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_outages_parroquia ON outages(parroquia);
CREATE INDEX idx_outages_updated   ON outages(updated_at DESC);

-- Constraint único para upsert (REQUERIDO)
ALTER TABLE outages ADD CONSTRAINT outages_parroquia_unique UNIQUE (parroquia);

-- RLS
ALTER TABLE outages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read"  ON outages FOR SELECT USING (true);
CREATE POLICY "service_write" ON outages FOR ALL USING (auth.role() = 'service_role');
```

> El constraint único `outages_parroquia_unique` es obligatorio. Sin él, los reportes comunitarios fallan con error 409.

---

## API — endpoints

### v1 (recomendado) — `/api/v1/data`

Todas las operaciones pasan por un solo endpoint para compatibilidad con el routing de Vercel.

**Respuestas estandarizadas:**
```json
// Éxito
{ "success": true, "data": {...}, "timestamp": "...", "apiVersion": "v1" }

// Error
{ "error": true, "status": 400, "message": "...", "details": {...}, "timestamp": "...", "apiVersion": "v1" }
```

### GET /api/v1/data
Devuelve el estado actual de las 18 parroquias.
```json
{
  "sectors": [{ "name": "Coquivacoa", "status": "ok", "hours": 0, ... }],
  "source": "supabase | fallback",
  "fetchedAt": "2026-03-21T...",
  "city": "Maracaibo",
  "apiVersion": "v1"
}
```
Parroquias sin fila en Supabase devuelven `"status": "nodata"`.

Parámetros query:
- `limit` (default: 200, max: 200)

### POST /api/v1/data — action: "analyze"
Análisis IA del sistema eléctrico.
```json
{ "action": "analyze", "prompt": "...", "systemPrompt": "..." }
```

### POST /api/data — action: "verify"
Verificador de autenticidad de un reporte.
```json
{ "action": "verify", "report": "texto del reporte" }
```

### POST /api/data — action: "report"
Envío de reporte comunitario. Valida con IA y hace upsert en Supabase.
```json
{ "action": "report", "parroquia": "Coquivacoa", "status": "cut", "cause": "...", "reporterNote": "..." }
```

### POST /api/data — action: "reports"
Últimos 20 reportes de Supabase para el feed comunitario.
```json
{ "action": "reports" }
```

---

## Fuentes de datos (prioridad)

| Prioridad | Fuente | Cuándo |
|---|---|---|
| 1 | **Supabase** | Siempre que tenga filas |
| 2 | **Twitter + Gemini** | Si Supabase está vacío y hay `TWITTER_BEARER_TOKEN` |
| 3 | **Fallback** | Devuelve todo en `nodata` |

---

## Parroquias (18)

Venancio Pulgar · Idelfonso Vásquez · Coquivacoa · Juana de Ávila · San Isidro · Antonio Borjas Romero · Caracciolo Parra Pérez · Olegario Villalobos · Chiquinquirá · Raúl Leoni · Francisco Eugenio Bustamante · Cacique Mara · Santa Lucía · Bolívar · Cecilio Acosta · Cristo de Aranza · Manuel Dagnino · Luis Hurtado Higuera

---

## Hecho con ♥ en Maracaibo

**Autor:** Aníbal Riera  
**Tecnologías:** Claude AI · OpenRouter (Gemini 2.0 Flash) · Vercel · Supabase · Leaflet · GitHub  
**Donaciones:** [paypal.me/ankosito](https://paypal.me/ankosito)  
**Sitio:** [hayluz.vercel.app](https://hayluz.vercel.app)
