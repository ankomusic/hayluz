-- =============================================
-- HAYLUZ v0.0.27 - Supabase Schema Updates
-- Run this after your existing schema
-- =============================================

-- Table for persistent rate limiting
CREATE TABLE IF NOT EXISTS rate_limits (
  id BIGSERIAL PRIMARY KEY,
  ip TEXT NOT NULL,
  count INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_limits_ip ON rate_limits(ip);

-- Updated RLS policies for outages table
-- Remove old policies first if they exist
DROP POLICY IF EXISTS "service_write" ON outages;
DROP POLICY IF EXISTS "public_insert" ON outages;

-- Read: anyone can read (public data)
CREATE POLICY "public_read_all" ON outages
  FOR SELECT USING (true);

-- Insert: authenticated service role only (for API writes)
CREATE POLICY "service_insert" ON outages
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- Update: only admin source or service role
CREATE POLICY "service_update" ON outages
  FOR UPDATE USING (
    auth.role() = 'service_role' 
    OR (source = 'admin' AND updated_at > NOW() - INTERVAL '24 hours')
  );

-- Delete: only service role
CREATE POLICY "service_delete" ON outages
  FOR DELETE USING (auth.role() = 'service_role');

-- Rate limits table RLS
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_rw_rate_limits" ON rate_limits
  FOR ALL USING (auth.role() = 'service_role');

-- =============================================
-- Circuit breaker state (optional - for monitoring)
-- =============================================
CREATE TABLE IF NOT EXISTS circuit_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  failures INTEGER DEFAULT 0,
  open_until TIMESTAMPTZ,
  last_failure TIMESTAMPTZ,
  last_success TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT single_row CHECK (id = 1)
);

INSERT INTO circuit_state (id, failures, last_success)
VALUES (1, 0, NOW())
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- API audit log (optional - for monitoring)
-- =============================================
CREATE TABLE IF NOT EXISTS api_audit_log (
  id BIGSERIAL PRIMARY KEY,
  endpoint TEXT NOT NULL,
  action TEXT,
  ip_hash TEXT,
  status_code INTEGER,
  duration_ms INTEGER,
  error_detail TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_endpoint ON api_audit_log(endpoint);
CREATE INDEX IF NOT EXISTS idx_audit_created ON api_audit_log(created_at DESC);

ALTER TABLE api_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_rw_audit" ON api_audit_log
  FOR ALL USING (auth.role() = 'service_role');
