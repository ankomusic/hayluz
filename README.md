# Hay Luz? — Monitor de cortes eléctricos · Maracaibo, Zulia

Aplicación web para monitorear caídas del sistema eléctrico en Maracaibo por sector, con verificador de autenticidad de reportes basado en IA.

## Funcionalidades

- **Monitor por sector** — Estado en tiempo real de cada sector de Maracaibo (corte activo, intermitente, estable)
- **Análisis IA** — Diagnóstico automático con Claude de la situación eléctrica
- **Verificador de autenticidad** — Analiza reportes de cortes (tweets, mensajes, etc.) y determina si son legítimos
- **Historial de incidentes** — Registro de eventos recientes

## Despliegue en Vercel

### 1. Instalar Vercel CLI (opcional)
```bash
npm i -g vercel
```

### 2. Clonar o subir el proyecto
Puedes subir esta carpeta directamente desde el dashboard de Vercel o usar el CLI:
```bash
cd maracaibo-light
vercel
```

### 3. Configurar variable de entorno

En el dashboard de Vercel → tu proyecto → Settings → Environment Variables:

| Variable | Valor |
|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` (tu API key de Anthropic) |

O desde CLI:
```bash
vercel env add ANTHROPIC_API_KEY
```

### 4. Desplegar
```bash
vercel --prod
```

## Estructura del proyecto

```
maracaibo-light/
├── public/
│   └── index.html        # App principal (HTML/CSS/JS)
├── api/
│   ├── analyze.js        # Endpoint: análisis general con IA
│   └── verify.js         # Endpoint: verificador de autenticidad
├── vercel.json           # Configuración de rutas
├── package.json
└── README.md
```

## Despliegue desde GitHub

1. Sube el proyecto a un repositorio GitHub
2. Ve a [vercel.com](https://vercel.com) → "Add New Project"
3. Importa el repositorio
4. Añade `ANTHROPIC_API_KEY` en las variables de entorno
5. Haz clic en Deploy

## Uso del verificador de autenticidad

El verificador analiza cualquier reporte sobre cortes eléctricos y evalúa:

- Si menciona una ubicación específica en Maracaibo
- Si incluye hora o duración
- Si cita alguna fuente
- Si tiene detalles técnicos creíbles
- Si es consistente con patrones del sistema eléctrico venezolano
- Señales de alerta (exageración, información contradictoria, etc.)

Devuelve un puntaje 0-100 y un veredicto: **Verificado / Probable / Dudoso / Falso**

## Notas

- Los datos de sectores son referenciales. Para producción, conectar a API de Corpoelec o fuentes comunitarias.
- La app funciona sin API key (sin funciones IA). Las funciones de análisis requieren `ANTHROPIC_API_KEY`.
