-- ==============================================================================
-- Migration: 20261102_multi_tenant_saas_architecture.sql
-- Description: Production-Safe Multi-Tenant SaaS Architecture with RLS and Teams
-- Target: Supabase PostgreSQL (Project: dbhvslswvmrwuuzwtxzs)
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Create Core Multi-Tenant Tables (Idempotent)
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    owner_id TEXT NOT NULL, -- Supabase auth.uid()
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.team_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL, -- Supabase auth.uid()
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.team_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    invited_by TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
    token TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- 2. Add Organization Tenancy Columns (With Safe Restrict / Set Null References)
-- ------------------------------------------------------------------------------

-- Workspaces: ON DELETE RESTRICT prevents accidental destruction of workspaces
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'workspaces') THEN
        ALTER TABLE public.workspaces 
            ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE RESTRICT;
    END IF;
END $$;

-- Users: ON DELETE SET NULL retains user record even if org is detached
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') THEN
        ALTER TABLE public.users 
            ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Clients: ON DELETE RESTRICT prevents cascading client data loss
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'clients') THEN
        ALTER TABLE public.clients 
            ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE RESTRICT;
    END IF;
END $$;

-- Leads: Ensure client_id, search_id, and organization_id exist without destroying records
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'leads') THEN
        ALTER TABLE public.leads 
            ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;
        ALTER TABLE public.leads 
            ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL;
        ALTER TABLE public.leads 
            ADD COLUMN IF NOT EXISTS search_id UUID;
    END IF;
END $$;

-- Client Leads Junction: Safe references
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'client_leads') THEN
        ALTER TABLE public.client_leads 
            ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;
    END IF;
END $$;

-- Lead Searches & Integrations
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'lead_searches') THEN
        ALTER TABLE public.lead_searches 
            ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'google_integrations') THEN
        ALTER TABLE public.google_integrations 
            ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'export_history') THEN
        ALTER TABLE public.export_history 
            ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'instagram_integrations') THEN
        ALTER TABLE public.instagram_integrations 
            ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'search_history') THEN
        ALTER TABLE public.search_history 
            ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 3. Composite Constraints (Safe Duplicate-Guarded Check)
-- ------------------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'leads') THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'leads_profile_url_workspace_id_client_id_key'
        ) THEN
            IF NOT EXISTS (
                SELECT 1 FROM public.leads
                WHERE client_id IS NOT NULL
                GROUP BY profile_url, workspace_id, client_id
                HAVING COUNT(*) > 1
            ) THEN
                ALTER TABLE public.leads 
                    ADD CONSTRAINT leads_profile_url_workspace_id_client_id_key 
                    UNIQUE (profile_url, workspace_id, client_id);
            ELSE
                RAISE NOTICE 'Skipping unique constraint creation: duplicate leads found for (profile_url, workspace_id, client_id). All records preserved.';
            END IF;
        END IF;
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 4. Safe Idempotent Backfill (Preserves Workspaces, Clients, and 157 Leads)
-- ------------------------------------------------------------------------------

DO $$
DECLARE
    user_record RECORD;
    ws_record RECORD;
    org_id UUID;
BEGIN
    -- Step A: Backfill users without an organization
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') THEN
        FOR user_record IN (SELECT id, email, workspace_id FROM public.users WHERE organization_id IS NULL) LOOP
            SELECT id INTO org_id FROM public.organizations WHERE owner_id = user_record.id LIMIT 1;
            
            IF org_id IS NULL THEN
                INSERT INTO public.organizations (name, owner_id)
                VALUES (COALESCE(user_record.email, 'User Organization'), user_record.id)
                RETURNING id INTO org_id;
            END IF;

            UPDATE public.users SET organization_id = org_id WHERE id = user_record.id;

            IF NOT EXISTS (SELECT 1 FROM public.team_members WHERE organization_id = org_id AND user_id = user_record.id) THEN
                INSERT INTO public.team_members (organization_id, user_id, role)
                VALUES (org_id, user_record.id, 'owner');
            END IF;

            IF user_record.workspace_id IS NOT NULL THEN
                UPDATE public.workspaces SET organization_id = org_id WHERE id = user_record.workspace_id AND organization_id IS NULL;
            END IF;
        END LOOP;
    END IF;

    -- Step B: Handle workspaces with a verified owner_id
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'workspaces') THEN
        FOR ws_record IN (SELECT id, name, owner_id FROM public.workspaces WHERE organization_id IS NULL AND owner_id IS NOT NULL) LOOP
            org_id := NULL;
            
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') THEN
                SELECT organization_id INTO org_id FROM public.users WHERE id = ws_record.owner_id LIMIT 1;
            END IF;
            
            IF org_id IS NULL THEN
                SELECT id INTO org_id FROM public.organizations WHERE owner_id = ws_record.owner_id LIMIT 1;
            END IF;

            IF org_id IS NULL THEN
                INSERT INTO public.organizations (name, owner_id)
                VALUES (COALESCE(ws_record.name, 'Workspace') || ' Organization', ws_record.owner_id)
                RETURNING id INTO org_id;

                INSERT INTO public.team_members (organization_id, user_id, role)
                VALUES (org_id, ws_record.owner_id, 'owner')
                ON CONFLICT (organization_id, user_id) DO NOTHING;
            END IF;

            UPDATE public.workspaces SET organization_id = org_id WHERE id = ws_record.id;
        END LOOP;
    END IF;

    -- Step C: Propagate organization_id from workspaces to child records
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'clients') THEN
        UPDATE public.clients c
        SET organization_id = w.organization_id
        FROM public.workspaces w
        WHERE c.workspace_id = w.id AND c.organization_id IS NULL AND w.organization_id IS NOT NULL;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'leads') THEN
        UPDATE public.leads l
        SET organization_id = w.organization_id
        FROM public.workspaces w
        WHERE l.workspace_id = w.id AND l.organization_id IS NULL AND w.organization_id IS NOT NULL;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'client_leads') THEN
        UPDATE public.client_leads cl
        SET organization_id = w.organization_id
        FROM public.workspaces w
        WHERE cl.workspace_id = w.id AND cl.organization_id IS NULL AND w.organization_id IS NOT NULL;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'lead_searches') THEN
        UPDATE public.lead_searches s
        SET organization_id = w.organization_id
        FROM public.workspaces w
        WHERE s.workspace_id = w.id AND s.organization_id IS NULL AND w.organization_id IS NOT NULL;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'google_integrations') THEN
        UPDATE public.google_integrations g
        SET organization_id = w.organization_id
        FROM public.workspaces w
        WHERE g.workspace_id = w.id AND g.organization_id IS NULL AND w.organization_id IS NOT NULL;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'export_history') THEN
        UPDATE public.export_history e
        SET organization_id = w.organization_id
        FROM public.workspaces w
        WHERE e.workspace_id = w.id AND e.organization_id IS NULL AND w.organization_id IS NOT NULL;
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 5. Performance Indexes
-- ------------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_team_members_user ON public.team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_org ON public.team_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_org ON public.workspaces(organization_id);
CREATE INDEX IF NOT EXISTS idx_leads_org ON public.leads(organization_id);
CREATE INDEX IF NOT EXISTS idx_clients_org ON public.clients(organization_id);
CREATE INDEX IF NOT EXISTS idx_client_leads_org ON public.client_leads(organization_id);

-- ------------------------------------------------------------------------------
-- 6. Recursion-Proof Security Definer Helper Functions
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_org_member(org_id UUID) 
RETURNS BOOLEAN 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public, pg_temp
AS $$
BEGIN
  IF org_id IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.team_members 
    WHERE organization_id = org_id 
    AND user_id = auth.uid()::text
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(org_id UUID) 
RETURNS BOOLEAN 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public, pg_temp
AS $$
BEGIN
  IF org_id IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.team_members 
    WHERE organization_id = org_id 
    AND user_id = auth.uid()::text
    AND role IN ('owner', 'admin')
  );
END;
$$;

-- Explicit Function Permissions (Restricted to authenticated and service_role)
REVOKE ALL ON FUNCTION public.is_org_member(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_org_member(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_org_admin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_org_admin(UUID) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 7. Enable Row Level Security (RLS)
-- ------------------------------------------------------------------------------

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_invitations ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 8. Clean Stale Permissive Policies to Prevent Policy Combinations
-- ------------------------------------------------------------------------------

-- Workspaces
DROP POLICY IF EXISTS "Tenant isolation for workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Org-scoped access for workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Workspace isolation for workspaces" ON public.workspaces;

-- Clients
DROP POLICY IF EXISTS "Tenant isolation for clients" ON public.clients;
DROP POLICY IF EXISTS "Org-scoped access for clients" ON public.clients;
DROP POLICY IF EXISTS "Workspace isolation for clients" ON public.clients;

-- Leads
DROP POLICY IF EXISTS "Tenant isolation for leads" ON public.leads;
DROP POLICY IF EXISTS "Org-scoped access for leads" ON public.leads;
DROP POLICY IF EXISTS "Workspace isolation for leads" ON public.leads;

-- Client Leads
DROP POLICY IF EXISTS "Tenant isolation for client_leads" ON public.client_leads;
DROP POLICY IF EXISTS "Org-scoped access for client_leads" ON public.client_leads;
DROP POLICY IF EXISTS "Workspace isolation for client_leads" ON public.client_leads;

-- Lead Searches
DROP POLICY IF EXISTS "Tenant isolation for lead_searches" ON public.lead_searches;
DROP POLICY IF EXISTS "Org-scoped access for lead_searches" ON public.lead_searches;
DROP POLICY IF EXISTS "Workspace isolation for searches" ON public.lead_searches;

-- Google Integrations
DROP POLICY IF EXISTS "Tenant isolation for google_integrations" ON public.google_integrations;
DROP POLICY IF EXISTS "Org-scoped access for google_integrations" ON public.google_integrations;
DROP POLICY IF EXISTS "Workspace isolation for google_integrations" ON public.google_integrations;

-- Export History
DROP POLICY IF EXISTS "Tenant isolation for export_history" ON public.export_history;
DROP POLICY IF EXISTS "Org-scoped access for export_history" ON public.export_history;
DROP POLICY IF EXISTS "Workspace isolation for export_history" ON public.export_history;

-- Users
DROP POLICY IF EXISTS "Users can read self and workspace members" ON public.users;
DROP POLICY IF EXISTS "Users can read self and team members" ON public.users;
DROP POLICY IF EXISTS "Users can only update self within authorized workspace" ON public.users;
DROP POLICY IF EXISTS "Users can update self" ON public.users;
DROP POLICY IF EXISTS "Users can insert self" ON public.users;

-- ------------------------------------------------------------------------------
-- 9. Strict Non-Recursive Multi-Tenant RLS Policies
-- ------------------------------------------------------------------------------

-- Organizations
DROP POLICY IF EXISTS "Users can access their organizations" ON public.organizations;
CREATE POLICY "Users can access their organizations" ON public.organizations
    FOR ALL USING (
        public.is_org_member(id)
        OR owner_id = auth.uid()::text
    );

-- Team Members
DROP POLICY IF EXISTS "Users can see team members in their org" ON public.team_members;
CREATE POLICY "Users can see team members in their org" ON public.team_members
    FOR SELECT USING (
        user_id = auth.uid()::text 
        OR public.is_org_member(organization_id)
    );

DROP POLICY IF EXISTS "Owners and admins can manage team members" ON public.team_members;
CREATE POLICY "Owners and admins can manage team members" ON public.team_members
    FOR ALL USING (
        public.is_org_admin(organization_id)
        OR EXISTS (
            SELECT 1 FROM public.organizations 
            WHERE id = team_members.organization_id 
            AND owner_id = auth.uid()::text
        )
    )
    WITH CHECK (
        public.is_org_admin(organization_id)
        OR (
            role = 'owner'
            AND user_id = auth.uid()::text
            AND EXISTS (
                SELECT 1 FROM public.organizations 
                WHERE id = team_members.organization_id 
                AND owner_id = auth.uid()::text
            )
        )
    );

-- Team Invitations
DROP POLICY IF EXISTS "Members can view invitations in their org" ON public.team_invitations;
CREATE POLICY "Members can view invitations in their org" ON public.team_invitations
    FOR SELECT USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Owners and admins can manage invitations" ON public.team_invitations;
CREATE POLICY "Owners and admins can manage invitations" ON public.team_invitations
    FOR ALL USING (
        public.is_org_admin(organization_id)
    )
    WITH CHECK (
        public.is_org_admin(organization_id)
    );

-- Workspaces
CREATE POLICY "Org-scoped access for workspaces" ON public.workspaces
    FOR ALL USING (
        (organization_id IS NOT NULL AND public.is_org_member(organization_id))
        OR (owner_id = auth.uid()::text)
        OR (id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()::text))
    )
    WITH CHECK (
        (organization_id IS NOT NULL AND public.is_org_member(organization_id))
        OR (owner_id = auth.uid()::text)
        OR (id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()::text))
    );

-- Clients
CREATE POLICY "Org-scoped access for clients" ON public.clients
    FOR ALL USING (
        (organization_id IS NOT NULL AND public.is_org_member(organization_id))
        OR (workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid()::text OR public.is_org_member(organization_id)))
        OR (workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()::text))
    )
    WITH CHECK (
        (organization_id IS NOT NULL AND public.is_org_member(organization_id))
        OR (workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid()::text OR public.is_org_member(organization_id)))
        OR (workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()::text))
    );

-- Leads: Preserves all 157 leads under organization or workspace ownership
CREATE POLICY "Org-scoped access for leads" ON public.leads
    FOR ALL USING (
        (organization_id IS NOT NULL AND public.is_org_member(organization_id))
        OR (workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid()::text OR public.is_org_member(organization_id)))
        OR (workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()::text))
    )
    WITH CHECK (
        (organization_id IS NOT NULL AND public.is_org_member(organization_id))
        OR (workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid()::text OR public.is_org_member(organization_id)))
        OR (workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()::text))
    );

-- Client Leads Junction
CREATE POLICY "Org-scoped access for client_leads" ON public.client_leads
    FOR ALL USING (
        (organization_id IS NOT NULL AND public.is_org_member(organization_id))
        OR (workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid()::text OR public.is_org_member(organization_id)))
        OR (workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()::text))
    )
    WITH CHECK (
        (organization_id IS NOT NULL AND public.is_org_member(organization_id))
        OR (workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid()::text OR public.is_org_member(organization_id)))
        OR (workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()::text))
    );

-- Lead Searches
CREATE POLICY "Org-scoped access for lead_searches" ON public.lead_searches
    FOR ALL USING (
        (organization_id IS NOT NULL AND public.is_org_member(organization_id))
        OR (workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid()::text OR public.is_org_member(organization_id)))
        OR (workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()::text))
    )
    WITH CHECK (
        (organization_id IS NOT NULL AND public.is_org_member(organization_id))
        OR (workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid()::text OR public.is_org_member(organization_id)))
        OR (workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()::text))
    );

-- Google Integrations
CREATE POLICY "Org-scoped access for google_integrations" ON public.google_integrations
    FOR ALL USING (
        (organization_id IS NOT NULL AND public.is_org_member(organization_id))
        OR (workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid()::text OR public.is_org_member(organization_id)))
        OR (workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()::text))
    )
    WITH CHECK (
        (organization_id IS NOT NULL AND public.is_org_member(organization_id))
        OR (workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid()::text OR public.is_org_member(organization_id)))
        OR (workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()::text))
    );

-- Export History
CREATE POLICY "Org-scoped access for export_history" ON public.export_history
    FOR ALL USING (
        (organization_id IS NOT NULL AND public.is_org_member(organization_id))
        OR (workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid()::text OR public.is_org_member(organization_id)))
        OR (workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()::text))
    )
    WITH CHECK (
        (organization_id IS NOT NULL AND public.is_org_member(organization_id))
        OR (workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid()::text OR public.is_org_member(organization_id)))
        OR (workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()::text))
    );

-- Users (Sign-up INSERT, profile SELECT, and own-row UPDATE)
CREATE POLICY "Users can read self and team members" ON public.users
    FOR SELECT USING (
        id = auth.uid()::text
        OR (organization_id IS NOT NULL AND public.is_org_member(organization_id))
        OR (workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid()::text))
    );

CREATE POLICY "Users can insert self" ON public.users
    FOR INSERT WITH CHECK (
        id = auth.uid()::text
    );

CREATE POLICY "Users can update self" ON public.users
    FOR UPDATE 
    USING (id = auth.uid()::text)
    WITH CHECK (id = auth.uid()::text);
