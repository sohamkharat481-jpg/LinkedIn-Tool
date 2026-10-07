-- LinkedIn Lead Finder - Supabase Database Schema with RLS
-- Generated for multi-tenant workspace isolation

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  workspace_id UUID NOT NULL,
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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_workspace_profile_url UNIQUE(workspace_id, profile_url)
);

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

-- INDEXES FOR PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_clients_workspace ON public.clients(workspace_id);
CREATE INDEX IF NOT EXISTS idx_leads_workspace ON public.leads(workspace_id);
CREATE INDEX IF NOT EXISTS idx_client_leads_client ON public.client_leads(client_id);
CREATE INDEX IF NOT EXISTS idx_searches_client ON public.lead_searches(client_id);

-- ENABLE ROW LEVEL SECURITY (RLS)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.export_history ENABLE ROW LEVEL SECURITY;

-- POLICIES (TENANT ISOLATION BY WORKSPACE_ID)
-- App users can only read/write records matching their assigned workspace_id
CREATE POLICY "Workspace isolation for clients" ON public.clients
  FOR ALL USING (workspace_id = (SELECT workspace_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Workspace isolation for searches" ON public.lead_searches
  FOR ALL USING (workspace_id = (SELECT workspace_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Workspace isolation for leads" ON public.leads
  FOR ALL USING (workspace_id = (SELECT workspace_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Workspace isolation for client_leads" ON public.client_leads
  FOR ALL USING (workspace_id = (SELECT workspace_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Workspace isolation for google_integrations" ON public.google_integrations
  FOR ALL USING (workspace_id = (SELECT workspace_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Workspace isolation for export_history" ON public.export_history
  FOR ALL USING (workspace_id = (SELECT workspace_id FROM public.users WHERE id = auth.uid()));
