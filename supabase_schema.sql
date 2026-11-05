-- LinkedIn Lead Finder - Supabase Database Schema with Robust RLS
-- Generated for multi-tenant workspace and organization isolation

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 0. WORKSPACES TABLE
CREATE TABLE IF NOT EXISTS public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID,
  owner_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  organization_id UUID,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. CLIENTS TABLE
CREATE TABLE IF NOT EXISTS public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  niche TEXT NOT NULL,
  notes TEXT,
  created_by TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. LEAD SEARCHES TABLE
CREATE TABLE IF NOT EXISTS public.lead_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  filters JSONB NOT NULL,
  candidates_found INT DEFAULT 0,
  valid_leads INT DEFAULT 0,
  duplicates_removed INT DEFAULT 0,
  final_lead_count INT DEFAULT 0,
  created_by_user_email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. LEADS TABLE
CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  headline TEXT,
  seniority TEXT,
  current_job_title TEXT NOT NULL,
  company_name TEXT NOT NULL,
  location TEXT,
  profile_url TEXT NOT NULL,
  connections_or_followers TEXT,
  last_activity_date TEXT,
  source TEXT DEFAULT 'LinkedIn Public Search',
  lead_type TEXT,
  business_category TEXT,
  business_website TEXT,
  business_phone TEXT,
  business_address TEXT,
  business_city TEXT,
  business_country TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  business_email TEXT,
  linkedin_profile_url TEXT,
  contact_source TEXT,
  contact_verification_status TEXT,
  instagram_username TEXT,
  instagram_profile_url TEXT,
  instagram_verification_status TEXT,
  instagram_verification_evidence TEXT,
  instagram_discovery_source TEXT,
  instagram_last_checked_at TIMESTAMPTZ,
  relevance_score DOUBLE PRECISION,
  relevance_explanation TEXT,
  relevance_breakdown JSONB,
  b2b_classification TEXT,
  is_deceased BOOLEAN,
  date_of_death TEXT,
  date_of_birth TEXT,
  entity_period TEXT,
  active_evidence TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_workspace_profile_url UNIQUE(workspace_id, profile_url)
);

-- 5. CLIENT LEADS TABLE (Junction table linking Leads to Clients with status & notes)
CREATE TABLE IF NOT EXISTS public.client_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  search_id UUID REFERENCES public.lead_searches(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'Not Contacted' CHECK (status IN ('Not Contacted', 'Contacted', 'Follow-up Required', 'Replied', 'Interested', 'Not Interested', 'Converted')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_client_lead UNIQUE(client_id, lead_id)
);

-- 6. GOOGLE INTEGRATIONS TABLE
CREATE TABLE IF NOT EXISTS public.google_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  spreadsheet_id TEXT NOT NULL,
  spreadsheet_url TEXT NOT NULL,
  sheet_title TEXT NOT NULL,
  last_exported_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6.5. GOOGLE TOKENS TABLE (Secure storage for OAuth refresh tokens)
CREATE TABLE IF NOT EXISTS public.google_tokens (
  user_id TEXT PRIMARY KEY,
  organization_id UUID,
  encrypted_refresh_token TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. EXPORT HISTORY TABLE
CREATE TABLE IF NOT EXISTS public.export_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  spreadsheet_id TEXT NOT NULL,
  exported_leads_count INT NOT NULL,
  skipped_duplicates_count INT DEFAULT 0,
  exported_by_email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. INSTAGRAM INTEGRATIONS TABLE
CREATE TABLE IF NOT EXISTS public.instagram_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  instagram_user_id TEXT NOT NULL,
  instagram_username TEXT,
  encrypted_access_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  connection_status TEXT DEFAULT 'Connected' CHECK (connection_status IN ('Connected', 'Expired', 'Error', 'Revoked')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_workspace_instagram_client UNIQUE(workspace_id, client_id)
);

-- INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_clients_workspace ON public.clients(workspace_id);
CREATE INDEX IF NOT EXISTS idx_leads_workspace ON public.leads(workspace_id);
CREATE INDEX IF NOT EXISTS idx_client_leads_client ON public.client_leads(client_id);
CREATE INDEX IF NOT EXISTS idx_searches_client ON public.lead_searches(client_id);
CREATE INDEX IF NOT EXISTS idx_instagram_integrations_workspace ON public.instagram_integrations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_instagram_integrations_client ON public.instagram_integrations(client_id);

-- ENABLE ROW LEVEL SECURITY (RLS)
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.export_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_tokens ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES — ROBUST MULTI-TENANT ISOLATION
-- ============================================================================

-- 0. GOOGLE TOKENS POLICY
DROP POLICY IF EXISTS "Tenant isolation for google_tokens" ON public.google_tokens;
CREATE POLICY "Tenant isolation for google_tokens" ON public.google_tokens
  FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

-- 1. WORKSPACES POLICY
DROP POLICY IF EXISTS "Tenant isolation for workspaces" ON public.workspaces;
CREATE POLICY "Tenant isolation for workspaces" ON public.workspaces
  FOR ALL
  USING (
    owner_id = auth.uid()::text
    OR id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()::text)
    OR organization_id IN (SELECT organization_id FROM public.users WHERE id = auth.uid()::text)
  );

-- 2. USERS POLICY
DROP POLICY IF EXISTS "Users can read self and workspace members" ON public.users;
CREATE POLICY "Users can read self and workspace members" ON public.users
  FOR SELECT
  USING (
    id = auth.uid()::text
    OR workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()::text)
    OR organization_id IN (SELECT organization_id FROM public.users WHERE id = auth.uid()::text)
  );

DROP POLICY IF EXISTS "Users can only update self within authorized workspace" ON public.users;
CREATE POLICY "Users can only update self within authorized workspace" ON public.users
  FOR UPDATE
  USING (id = auth.uid()::text)
  WITH CHECK (id = auth.uid()::text);

-- 3. CLIENTS POLICY
DROP POLICY IF EXISTS "Tenant isolation for clients" ON public.clients;
CREATE POLICY "Tenant isolation for clients" ON public.clients
  FOR ALL
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces 
      WHERE owner_id = auth.uid()::text 
      OR id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()::text)
    )
  );

-- 4. LEADS POLICY
DROP POLICY IF EXISTS "Tenant isolation for leads" ON public.leads;
CREATE POLICY "Tenant isolation for leads" ON public.leads
  FOR ALL
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces 
      WHERE owner_id = auth.uid()::text 
      OR id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()::text)
    )
  );

-- 5. CLIENT LEADS JUNCTION POLICY
DROP POLICY IF EXISTS "Tenant isolation for client_leads" ON public.client_leads;
CREATE POLICY "Tenant isolation for client_leads" ON public.client_leads
  FOR ALL
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces 
      WHERE owner_id = auth.uid()::text 
      OR id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()::text)
    )
  );

-- 6. LEAD SEARCHES POLICY
DROP POLICY IF EXISTS "Tenant isolation for lead_searches" ON public.lead_searches;
CREATE POLICY "Tenant isolation for lead_searches" ON public.lead_searches
  FOR ALL
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces 
      WHERE owner_id = auth.uid()::text 
      OR id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()::text)
    )
  );

-- 7. GOOGLE INTEGRATIONS POLICY
DROP POLICY IF EXISTS "Tenant isolation for google_integrations" ON public.google_integrations;
CREATE POLICY "Tenant isolation for google_integrations" ON public.google_integrations
  FOR ALL
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces 
      WHERE owner_id = auth.uid()::text 
      OR id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()::text)
    )
  );

-- 8. EXPORT HISTORY POLICY
DROP POLICY IF EXISTS "Tenant isolation for export_history" ON public.export_history;
CREATE POLICY "Tenant isolation for export_history" ON public.export_history
  FOR ALL
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces 
      WHERE owner_id = auth.uid()::text 
      OR id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()::text)
    )
  );

-- 9. INSTAGRAM INTEGRATIONS POLICY
DROP POLICY IF EXISTS "Tenant isolation for instagram_integrations" ON public.instagram_integrations;
CREATE POLICY "Tenant isolation for instagram_integrations" ON public.instagram_integrations
  FOR ALL
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces 
      WHERE owner_id = auth.uid()::text 
      OR id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()::text)
    )
  );

-- Revoke all access from unauthenticated anon role
REVOKE ALL ON public.instagram_integrations FROM anon;
REVOKE ALL ON public.google_tokens FROM anon;

-- Service role maintains full access
GRANT ALL ON public.instagram_integrations TO service_role;
GRANT ALL ON public.google_tokens TO service_role;
