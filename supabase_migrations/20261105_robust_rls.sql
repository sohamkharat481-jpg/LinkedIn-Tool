-- Robust RLS Policies for LinkedIn Lead Finder
-- This migration updates RLS policies to use multiple verification paths:
-- 1. Direct workspace ownership (workspaces.owner_id)
-- 2. Organization membership (team_members)
-- 3. Legacy user-workspace mapping (users table)

-- Enable RLS on all relevant tables
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_tokens ENABLE ROW LEVEL SECURITY;

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
    OR organization_id IN (SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()::text)
  );

-- 2. CLIENTS POLICY
DROP POLICY IF EXISTS "Tenant isolation for clients" ON public.clients;
CREATE POLICY "Tenant isolation for clients" ON public.clients
  FOR ALL
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces 
      WHERE owner_id = auth.uid()::text 
      OR id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()::text)
      OR organization_id IN (SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()::text)
    )
  );

-- 3. LEADS POLICY
DROP POLICY IF EXISTS "Tenant isolation for leads" ON public.leads;
CREATE POLICY "Tenant isolation for leads" ON public.leads
  FOR ALL
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces 
      WHERE owner_id = auth.uid()::text 
      OR id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()::text)
      OR organization_id IN (SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()::text)
    )
  );

-- 4. CLIENT LEADS JUNCTION POLICY
DROP POLICY IF EXISTS "Tenant isolation for client_leads" ON public.client_leads;
CREATE POLICY "Tenant isolation for client_leads" ON public.client_leads
  FOR ALL
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces 
      WHERE owner_id = auth.uid()::text 
      OR id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()::text)
      OR organization_id IN (SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()::text)
    )
  );

-- 5. LEAD SEARCHES POLICY
DROP POLICY IF EXISTS "Tenant isolation for lead_searches" ON public.lead_searches;
CREATE POLICY "Tenant isolation for lead_searches" ON public.lead_searches
  FOR ALL
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces 
      WHERE owner_id = auth.uid()::text 
      OR id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()::text)
      OR organization_id IN (SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()::text)
    )
  );
