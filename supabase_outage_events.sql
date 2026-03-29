-- Tabla de historial de eventos de cortes eléctricos
CREATE TABLE IF NOT EXISTS outage_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  parish TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('started', 'escalated', 'restored', 'intermittent', 'updated')),
  previous_status TEXT CHECK (previous_status IN ('ok', 'inter', 'cut', NULL)),
  new_status TEXT NOT NULL CHECK (new_status IN ('ok', 'inter', 'cut')),
  hours_before_event INT DEFAULT 0,
  cause TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para optimizar queries
CREATE INDEX IF NOT EXISTS idx_events_created_at ON outage_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_parish ON outage_events(parish);
CREATE INDEX IF NOT EXISTS idx_events_parish_created ON outage_events(parish, created_at DESC);

-- Políticas RLS ( Row Level Security)
ALTER TABLE outage_events ENABLE ROW LEVEL SECURITY;

-- Permitir lectura pública
CREATE POLICY "Public read access" ON outage_events
  FOR SELECT USING (true);

-- Permitir insert desde service key (API)
CREATE POLICY "Service role insert" ON outage_events
  FOR INSERT WITH CHECK (true);

-- Comentarios
COMMENT ON TABLE outage_events IS 'Historial de eventos de cortes eléctricos por parroquia';
COMMENT ON COLUMN outage_events.event_type IS 'started: inicio de corte, escalated: empeoró, restored: restaurado, intermittent: volvió a fallar, updated: info actualizada';
