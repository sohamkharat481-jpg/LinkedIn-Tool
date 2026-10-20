-- LinkedIn Lead Finder - Supabase Database Schema with RLS
-- Generated for multi-tenant workspace isolation

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 0. WORKSPACES TABLE
CREATE TABLE IF NOT EXISTS public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. CLIENTS TABLE
CREATE TABLE IF NOT EXISTS public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  name TEXT NOT NULL,
  niche TEXT NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. LEAD SEARCHES TABLE
CREATE TABLE IF NOT EXISTS public.lead_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
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
  workspace_id UUID NOT NULL,
  full_name TEXT NOT NULL,
  headline TEXT,
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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_workspace_profile_url UNIQUE(workspace_id, profile_url)
);

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS lead_type TEXT,
  ADD COLUMN IF NOT EXISTS business_category TEXT,
  ADD COLUMN IF NOT EXISTS business_website TEXT,
  ADD COLUMN IF NOT EXISTS business_phone TEXT,
  ADD COLUMN IF NOT EXISTS business_address TEXT,
  ADD COLUMN IF NOT EXISTS business_city TEXT,
  ADD COLUMN IF NOT EXISTS business_country TEXT,
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

-- 5. CLIENT LEADS TABLE (Junction table linking Leads to Clients with status & notes)
CREATE TABLE IF NOT EXISTS public.client_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  search_id UUID REFERENCES public.lead_searches(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'Not Contacted' CHECK (status IN ('Not Contacted', 'Request Sent', 'Accepted', 'Replied', 'Call Booked')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_client_lead UNIQUE(client_id, lead_id)
);

-- 6. GOOGLE INTEGRATIONS TABLE
CREATE TABLE IF NOT EXISTS public.google_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  spreadsheet_id TEXT NOT NULL,
  spreadsheet_url TEXT NOT NULL,
  sheet_title TEXT NOT NULL,
  last_exported_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. EXPORT HISTORY TABLE
CREATE TABLE IF NOT EXISTS public.export_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
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
  workspace_id UUID NOT NULL,
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

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES — STRICT MULTI-TENANT ISOLATION
--
-- SECURITY NOTE:
-- A naive policy checking only 'workspace_id IS NOT NULL' IS INSECURE and DOES NOT
-- provide tenant isolation, because any authenticated user would be permitted to
-- access, insert, or manipulate records belonging to any workspace.
--
-- True tenant isolation requires checking that the record's workspace_id matches
-- a workspace authorized for the authenticated user (auth.uid()).
--
-- Both USING and WITH CHECK clauses are mandatory:
-- - USING controls which existing rows can be read (SELECT), updated (UPDATE), or deleted (DELETE).
-- - WITH CHECK ensures that new rows (INSERT) and modified rows (UPDATE) cannot be inserted into
--   or moved into an unauthorized workspace.
-- ============================================================================

-- 0. WORKSPACES ISOLATION POLICY
CREATE POLICY "Tenant isolation for workspaces" ON public.workspaces
  FOR ALL
  USING (id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()));

-- 1. USERS ISOLATION POLICY
CREATE POLICY "Users can read self and workspace members" ON public.users
  FOR SELECT
  USING (
    id = auth.uid()
    OR workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid())
  );

CREATE POLICY "Users can only update self within authorized workspace" ON public.users
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid())
  );

-- 2. CLIENTS ISOLATION POLICY
-- Prevents selecting, modifying, deleting other workspaces' clients, AND prevents moving clients cross-workspace
CREATE POLICY "Tenant isolation for clients" ON public.clients
  FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()));

-- 3. LEAD SEARCHES ISOLATION POLICY
CREATE POLICY "Tenant isolation for lead_searches" ON public.lead_searches
  FOR ALL
  USING (
    workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid())
    AND client_id IN (SELECT id FROM public.clients WHERE workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()))
  )
  WITH CHECK (
    workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid())
    AND client_id IN (SELECT id FROM public.clients WHERE workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()))
  );

-- 4. LEADS ISOLATION POLICY
CREATE POLICY "Tenant isolation for leads" ON public.leads
  FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()));

-- 5. CLIENT LEADS JUNCTION ISOLATION POLICY
CREATE POLICY "Tenant isolation for client_leads" ON public.client_leads
  FOR ALL
  USING (
    workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid())
    AND client_id IN (SELECT id FROM public.clients WHERE workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()))
    AND lead_id IN (SELECT id FROM public.leads WHERE workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()))
  )
  WITH CHECK (
    workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid())
    AND client_id IN (SELECT id FROM public.clients WHERE workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()))
    AND lead_id IN (SELECT id FROM public.leads WHERE workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()))
  );

-- 6. GOOGLE INTEGRATIONS ISOLATION POLICY
CREATE POLICY "Tenant isolation for google_integrations" ON public.google_integrations
  FOR ALL
  USING (
    workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid())
    AND (client_id IS NULL OR client_id IN (SELECT id FROM public.clients WHERE workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid())))
  )
  WITH CHECK (
    workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid())
    AND (client_id IS NULL OR client_id IN (SELECT id FROM public.clients WHERE workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid())))
  );

-- 7. EXPORT HISTORY ISOLATION POLICY
CREATE POLICY "Tenant isolation for export_history" ON public.export_history
  FOR ALL
  USING (
    workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid())
    AND client_id IN (SELECT id FROM public.clients WHERE workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()))
  )
  WITH CHECK (
    workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid())
    AND client_id IN (SELECT id FROM public.clients WHERE workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()))
  );

-- 8. INSTAGRAM INTEGRATIONS ISOLATION POLICY
CREATE POLICY "Tenant isolation for instagram_integrations" ON public.instagram_integrations
  FOR ALL
  USING (
    workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid())
    AND client_id IN (SELECT id FROM public.clients WHERE workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()))
  )
  WITH CHECK (
    workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid())
    AND client_id IN (SELECT id FROM public.clients WHERE workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()))
  );

-- Revoke all access from unauthenticated anon role
REVOKE ALL ON public.instagram_integrations FROM anon;

-- Restrict authenticated client users to non-sensitive status columns (encrypted_access_token is never readable by frontend)
REVOKE ALL ON public.instagram_integrations FROM authenticated;
GRANT SELECT (id, workspace_id, client_id, instagram_user_id, instagram_username, connection_status, token_expires_at, created_at, updated_at)
  ON public.instagram_integrations TO authenticated;

-- Service role maintains full access for backend token encryption/decryption
GRANT ALL ON public.instagram_integrations TO service_role;

