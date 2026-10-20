-- Migration: 20261020_enhance_workspace_tenant_isolation_rls.sql
-- Description: Hardens Row Level Security (RLS) policies with strict tenant isolation,
-- explicit USING and WITH CHECK clauses, and prevention of cross-workspace access or record reassignment.

-- 0. Ensure workspaces table exists
CREATE TABLE IF NOT EXISTS public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS across all tables
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.export_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_integrations ENABLE ROW LEVEL SECURITY;

-- Drop legacy/insecure policies if they exist
DROP POLICY IF EXISTS "Workspace isolation for clients" ON public.clients;
DROP POLICY IF EXISTS "Workspace isolation for searches" ON public.lead_searches;
DROP POLICY IF EXISTS "Workspace isolation for leads" ON public.leads;
DROP POLICY IF EXISTS "Workspace isolation for client_leads" ON public.client_leads;
DROP POLICY IF EXISTS "Workspace isolation for google_integrations" ON public.google_integrations;
DROP POLICY IF EXISTS "Workspace isolation for export_history" ON public.export_history;
DROP POLICY IF EXISTS "Workspace isolation for instagram_integrations" ON public.instagram_integrations;
DROP POLICY IF EXISTS "Tenant isolation for workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Tenant isolation for clients" ON public.clients;
DROP POLICY IF EXISTS "Tenant isolation for lead_searches" ON public.lead_searches;
DROP POLICY IF EXISTS "Tenant isolation for leads" ON public.leads;
DROP POLICY IF EXISTS "Tenant isolation for client_leads" ON public.client_leads;
DROP POLICY IF EXISTS "Tenant isolation for google_integrations" ON public.google_integrations;
DROP POLICY IF EXISTS "Tenant isolation for export_history" ON public.export_history;
DROP POLICY IF EXISTS "Tenant isolation for instagram_integrations" ON public.instagram_integrations;

-- ============================================================================
-- 1. WORKSPACES
-- ============================================================================
CREATE POLICY "Tenant isolation for workspaces" ON public.workspaces
  FOR ALL
  USING (id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()));

-- ============================================================================
-- 2. USERS
-- ============================================================================
DROP POLICY IF EXISTS "Users can read self and workspace members" ON public.users;
CREATE POLICY "Users can read self and workspace members" ON public.users
  FOR SELECT
  USING (
    id = auth.uid()
    OR workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can only update self within authorized workspace" ON public.users;
CREATE POLICY "Users can only update self within authorized workspace" ON public.users
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid())
  );

-- ============================================================================
-- 3. CLIENTS
-- Protects against cross-tenant SELECT, INSERT, UPDATE, DELETE
-- WITH CHECK prevents inserting into unauthorized workspaces or moving clients to another workspace
-- ============================================================================
CREATE POLICY "Tenant isolation for clients" ON public.clients
  FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()));

-- ============================================================================
-- 4. LEAD SEARCHES
-- ============================================================================
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

-- ============================================================================
-- 5. LEADS
-- ============================================================================
CREATE POLICY "Tenant isolation for leads" ON public.leads
  FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()));

-- ============================================================================
-- 6. CLIENT LEADS JUNCTION
-- ============================================================================
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

-- ============================================================================
-- 7. GOOGLE INTEGRATIONS
-- ============================================================================
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

-- ============================================================================
-- 8. EXPORT HISTORY
-- ============================================================================
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

-- ============================================================================
-- 9. INSTAGRAM INTEGRATIONS
-- ============================================================================
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
