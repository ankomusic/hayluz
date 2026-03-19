# Hay Luz? — Monitor eléctrico de Venezuela

Monitor de cortes eléctricos en tiempo real por parroquia para Maracaibo, Zulia. Construido con HTML/CSS/JS puro en el frontend, Vercel serverless en el backend, Supabase como base de datos, OpenRouter como gateway de IA, y Leaflet para los mapas interactivos.

---

## Funcionalidades

- **Monitor por parroquia** — 19 parroquias del Municipio Maracaibo con estado en tiempo real (corte, intermitente, estable)
- **Mapa interactivo** — Polígonos georreferenciados sobre OpenStreetMap con colores dinámicos según el voltaje simulado
- **Alertas de fluctuación** — Monitor de voltaje en tiempo real con umbrales configurables y notificaciones del navegador
- **Análisis IA** — Diagnóstico automático del sistema eléctrico vía OpenRouter (Gemini Flash por defecto)
- **Verificador de autenticidad** — Evalúa si un reporte de corte es verídico, con puntaje 0-100 y veredicto
- **Reportes comunitarios** — Los usuarios pueden reportar cortes desde la app; validados por IA antes de guardarse
- **Panel de administración** — Interfaz protegida en `/admin` para actualizar estados sin tocar Supabase directamente
- **PWA** — Instalable en móvil, funciona offline, con service worker y manifest
- **Modo oscuro/claro** — Toggle con persistencia visual

---

## Estructura del proyecto

```
hayluz/
├── public/
│   ├── index.html        # App principal (frontend completo)
│   ├── admin.html        # Panel de administración (protegido)
│   ├── manifest.json     # PWA manifest
│   ├── sw.js             # Service worker
│   └── icons/
│       ├── icon-192.svg
│       └── icon-512.svg
├── api/
│   ├── data.js           # GET  — lee parroquias desde Supabase o Twitter+IA
│   ├── analyze.js        # POST — análisis IA del sistema eléctrico
│   ├── verify.js         # POST — verificador de autenticidad de reportes
│   ├── report.js         # POST — recibe reportes comunitarios
│   └── admin.js          # GET/POST/DELETE — operaciones admin (requiere x-admin-secret)
├── vercel.json           # Config de Vercel (outputDirectory, headers, rewrites)
├── package.json          # type: module, node >=18
└── README.md
```

---

## Variables de entorno

Configúralas en Vercel → tu proyecto → Settings → Environment Variables:

| Variable | Requerida | Descripción |
|---|---|---|
| `OPENROUTER_API_KEY` | ✅ Sí | API key de openrouter.ai — para análisis IA, verificador y reportes |
| `SUPABASE_URL` | ✅ Sí | URL de tu proyecto Supabase (`https://xxxx.supabase.co`) |
| `SUPABASE_ANON_KEY` | ✅ Sí | Clave pública de Supabase — solo lectura desde el API de datos |
| `SUPABASE_SERVICE_KEY` | ✅ Sí | Clave privada de Supabase — escritura desde `/api/report` y `/api/admin` |
| `ADMIN_SECRET` | ✅ Sí | Contraseña para acceder al panel `/admin` |
| `TWITTER_BEARER_TOKEN` | ⬜ Opcional | Bearer token de la API v2 de Twitter/X — activa scraping automático de tweets |

> **Importante:** Nunca expongas `SUPABASE_SERVICE_KEY` ni `ADMIN_SECRET` en el frontend. Solo se usan en archivos dentro de `/api/`.

---

## Despliegue en Vercel

### Opción A — desde GitHub (recomendado)

1. Sube este repositorio a GitHub
2. Ve a [vercel.com](https://vercel.com) → **Add New Project** → importa el repositorio
3. Vercel detecta automáticamente la configuración de `vercel.json`
4. Agrega las variables de entorno en **Settings → Environment Variables**
5. Haz clic en **Deploy**

### Opción B — Vercel CLI

```bash
npm i -g vercel
vercel          # primer deploy (te pedirá login y configuración)
vercel --prod   # deploy a producción
```

### Agregar variables desde CLI

```bash
vercel env add OPENROUTER_API_KEY
vercel env add SUPABASE_URL
vercel env add SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_KEY
vercel env add ADMIN_SECRET
vercel env add TWITTER_BEARER_TOKEN   # opcional
```

---

## Configuración de Supabase

### 1. Crear el proyecto

Ve a [supabase.com](https://supabase.com) → New Project. Guarda la URL y las claves.

### 2. Crear la tabla `outages`

En **SQL Editor**, ejecuta:

```sql
CREATE TABLE outages (
  id            BIGSERIAL PRIMARY KEY,
  parroquia     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'ok',  -- ok | inter | cut
  hours         INTEGER DEFAULT 0,
  since         TEXT DEFAULT '—',
  cause         TEXT DEFAULT '—',
  affected      INTEGER DEFAULT 0,           -- porcentaje 0-100
  reporter_note TEXT,
  confidence    TEXT DEFAULT 'high',
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_outages_parroquia ON outages(parroquia);
CREATE INDEX idx_outages_updated   ON outages(updated_at DESC);
```

### 3. Configurar Row Level Security (RLS)

```sql
ALTER TABLE outages ENABLE ROW LEVEL SECURITY;

-- Lectura pública (la app puede leer sin autenticar)
CREATE POLICY "public_read" ON outages
  FOR SELECT USING (true);

-- Solo escritura con service_role (desde el backend)
CREATE POLICY "service_write" ON outages
  FOR ALL USING (auth.role() = 'service_role');
```

---

## Integración con Twitter/X

La integración con Twitter permite que la app lea tweets recientes sobre cortes eléctricos en Maracaibo y los interprete automáticamente con IA para actualizar el estado de las parroquias. Se activa solo cuando Supabase no devuelve datos.

### Paso 1 — Crear cuenta de desarrollador

1. Ve a [developer.twitter.com](https://developer.twitter.com)
2. Inicia sesión con tu cuenta de Twitter/X
3. Haz clic en **"Sign up for Free Account"**
4. Completa el formulario: describe el uso ("monitor de cortes eléctricos en Venezuela, uso no comercial")
5. Acepta los términos y espera la aprobación (generalmente inmediata en el plan Basic)

### Paso 2 — Crear un proyecto y app

1. En el dashboard, haz clic en **"+ Create Project"**
2. Nombre: `hayluz-monitor` — tipo: **Web App**
3. Dentro del proyecto, crea una **App**
4. En la sección **"Keys and Tokens"** de tu app:
   - Haz clic en **"Generate"** junto a **Bearer Token**
   - Copia el token (empieza con `AAAA...`)

### Paso 3 — Agregar el token en Vercel

```bash
vercel env add TWITTER_BEARER_TOKEN
# pega el Bearer Token cuando te lo pida
```

O en el dashboard de Vercel → Settings → Environment Variables → Add.

### Paso 4 — Verificar que funciona

Una vez desplegado, visita:

```
https://tu-app.vercel.app/api/data
```

Si el token está bien configurado y Supabase no tiene datos, la respuesta incluirá:

```json
{
  "source": "twitter+ai",
  "fetchedAt": "2026-03-19T...",
  ...
}
```

Si ves `"source": "supabase"` — Supabase tiene datos y Twitter no se usa. Si ves `"source": "fallback"` — ni Supabase ni Twitter respondieron correctamente.

### Límites del plan gratuito de Twitter

| Plan | Tweets leídos/mes | Precio |
|---|---|---|
| **Free** | 500,000 | $0 |
| Basic | 10,000,000 | $100/mes |

Con la configuración actual (20 tweets cada vez que `/api/data` se llama sin datos en Supabase, y caché de 2 minutos), el consumo estimado es bien por debajo del límite gratuito.

### Query de búsqueda (personalizable)

En `api/data.js`, puedes modificar la query de Twitter:

```js
// Búsqueda actual (amplia)
'(corpoelec OR "sin luz" OR "corte electrico") (maracaibo OR zulia) lang:es -is:retweet'

// Solo cuenta oficial de Corpoelec
'from:corpoelec lang:es'

// Por parroquia específica
'("juana de avila" OR coquivacoa OR urdaneta) "sin luz" lang:es'

// Combinada — oficial + menciones
'(from:corpoelec OR (#maracaibo "sin luz")) lang:es -is:retweet'
```

### Cómo funciona el flujo completo

```
Usuario abre la app
       ↓
/api/data (GET, caché 2 min)
       ↓
¿Hay datos en Supabase? ──────────────────────── Sí → devuelve sectores
       ↓ No
¿Hay TWITTER_BEARER_TOKEN?
       ↓ Sí
Twitter API v2 — últimos 20 tweets con la query configurada
       ↓
OpenRouter (Gemini Flash) lee los tweets y devuelve JSON por parroquia
       ↓
Respuesta al frontend → mapa y tarjetas se actualizan
       ↓
Se repite cada 5 minutos
```

---

## Panel de administración

Accede en `/admin`. Introduce la contraseña que configuraste en `ADMIN_SECRET`.

Desde el panel puedes:
- Ver el estado actual de todas las parroquias
- Actualizar el estado de cualquier parroquia (corte / intermitente / estable)
- Indicar causa, horas de corte, hora de inicio y porcentaje de afectación
- Los cambios se guardan en Supabase y la app los refleja en la próxima actualización

---

## Fuentes de datos (prioridad)

| Prioridad | Fuente | Cuándo se usa |
|---|---|---|
| 1 | **Supabase** | Siempre que tenga filas en la tabla `outages` |
| 2 | **Twitter + OpenRouter AI** | Solo si Supabase está vacío o sin configurar |
| 3 | **Fallback estático** | Si ninguna fuente responde — muestra todo en "ok" |

---

## Parroquias incluidas (Municipio Maracaibo)

Coquivacoa · Urdaneta · Idelfonso Vásquez · Venancio Pulgar · Juana de Ávila · Olegario Villalobos · Bolívar · Santa Lucía · Chiquinquirá · Caracciolo Parra Pérez · Raúl Leoni · Cacique Mara · Cecilio Acosta · Antonio Borjas Romero · San Isidro · Francisco Eugenio Bustamante · Manuel Dagnino · Cristo de Aranza · Luis Hurtado Higuera

---

## Hecho con ♥ en Maracaibo

**Autor:** Aníbal Riera  
**Tecnologías:** Claude AI · OpenRouter · Vercel · Supabase · Leaflet · GitHub  
**Donaciones:** [paypal.me/ankosito](https://paypal.me/ankosito)
