-- Migration: 20261102_multi_tenant_saas_architecture.sql
-- Description: Implements Multi-Tenant Organization architecture with Teams and Roles.

-- 1. Create Organizations Table
CREATE TABLE IF NOT EXISTS public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    owner_id TEXT NOT NULL, -- Firebase UID or Supabase UUID
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create Team Members Table (Roles: owner, admin, member)
CREATE TABLE IF NOT EXISTS public.team_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL, -- auth.uid()
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, user_id)
);

-- 3. Add organization_id to existing tables
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.lead_searches ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.google_integrations ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.export_history ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.instagram_integrations ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

-- 3.1 Unique Constraints for multi-tenancy
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_profile_url_workspace_id_client_id_key;
ALTER TABLE public.leads ADD CONSTRAINT leads_profile_url_workspace_id_client_id_key UNIQUE (profile_url, workspace_id, client_id);

-- 4. Create Invitations Table
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

-- 5. Data Migration (Backfill for existing workspace-based architecture)
DO $$
DECLARE
    user_record RECORD;
    org_id UUID;
BEGIN
    -- For each existing user that has a workspace_id but no organization_id
    FOR user_record IN (SELECT id, email, workspace_id FROM public.users WHERE organization_id IS NULL) LOOP
        -- Create an organization for the user
        INSERT INTO public.organizations (name, owner_id)
        VALUES (COALESCE(user_record.email, 'My Organization'), user_record.id)
        RETURNING id INTO org_id;

        -- Link user to organization
        UPDATE public.users SET organization_id = org_id WHERE id = user_record.id;

        -- Create team member record
        INSERT INTO public.team_members (organization_id, user_id, role)
        VALUES (org_id, user_record.id, 'owner');

        -- Link the user's workspace to the organization
        IF user_record.workspace_id IS NOT NULL THEN
            UPDATE public.workspaces SET organization_id = org_id WHERE id = user_record.workspace_id;
            
            -- Cascade organization_id to all records belonging to this workspace
            UPDATE public.clients SET organization_id = org_id WHERE workspace_id = user_record.workspace_id;
            UPDATE public.leads SET organization_id = org_id WHERE workspace_id = user_record.workspace_id;
            UPDATE public.lead_searches SET organization_id = org_id WHERE workspace_id = user_record.workspace_id;
            UPDATE public.google_integrations SET organization_id = org_id WHERE workspace_id = user_record.workspace_id;
            UPDATE public.export_history SET organization_id = org_id WHERE workspace_id = user_record.workspace_id;
            UPDATE public.instagram_integrations SET organization_id = org_id WHERE workspace_id = user_record.workspace_id;
        END IF;
    END LOOP;

    -- Also handle orphaned workspaces that have an owner_id
    FOR user_record IN (SELECT id, owner_id FROM public.workspaces WHERE organization_id IS NULL AND owner_id IS NOT NULL) LOOP
        -- If the owner already has an organization (from the users loop), use it
        SELECT organization_id INTO org_id FROM public.users WHERE id = user_record.owner_id LIMIT 1;
        
        IF org_id IS NULL THEN
            -- Create a new organization if user didn't have one
            INSERT INTO public.organizations (name, owner_id)
            VALUES ('Legacy Organization', user_record.owner_id)
            RETURNING id INTO org_id;
            
            -- Try to link user if exists
            UPDATE public.users SET organization_id = org_id WHERE id = user_record.owner_id;
            
            INSERT INTO public.team_members (organization_id, user_id, role)
            VALUES (org_id, user_record.owner_id, 'owner');
        END IF;

        UPDATE public.workspaces SET organization_id = org_id WHERE id = user_record.id;
        UPDATE public.clients SET organization_id = org_id WHERE workspace_id = user_record.id;
        UPDATE public.leads SET organization_id = org_id WHERE workspace_id = user_record.id;
        UPDATE public.lead_searches SET organization_id = org_id WHERE workspace_id = user_record.id;
        UPDATE public.google_integrations SET organization_id = org_id WHERE workspace_id = user_record.id;
        UPDATE public.export_history SET organization_id = org_id WHERE workspace_id = user_record.id;
        UPDATE public.instagram_integrations SET organization_id = org_id WHERE workspace_id = user_record.id;
    END LOOP;
END $$;

-- 6. Indexes for Performance
CREATE INDEX IF NOT EXISTS idx_team_members_user ON public.team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_org ON public.team_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_org ON public.workspaces(organization_id);
CREATE INDEX IF NOT EXISTS idx_leads_org ON public.leads(organization_id);
CREATE INDEX IF NOT EXISTS idx_clients_org ON public.clients(organization_id);

-- 7. ENABLE ROW LEVEL SECURITY (RLS)
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_invitations ENABLE ROW LEVEL SECURITY;

-- 8. STRICT MULTI-TENANT RLS POLICIES

-- Helper Function to check organization membership
CREATE OR REPLACE FUNCTION public.is_org_member(org_id UUID) 
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.team_members 
    WHERE organization_id = org_id 
    AND user_id = auth.uid()::text
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Organizations Policy
CREATE POLICY "Users can access their organizations" ON public.organizations
    FOR ALL USING (is_org_member(id));

-- Team Members Policy
CREATE POLICY "Users can see team members in their org" ON public.team_members
    FOR SELECT USING (is_org_member(organization_id));

CREATE POLICY "Owners and admins can manage team members" ON public.team_members
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.team_members 
            WHERE organization_id = team_members.organization_id 
            AND user_id = auth.uid()::text 
            AND role IN ('owner', 'admin')
        )
    );

-- Workspace Policy (Scoped to Org)
DROP POLICY IF EXISTS "Tenant isolation for workspaces" ON public.workspaces;
CREATE POLICY "Org-scoped access for workspaces" ON public.workspaces
    FOR ALL USING (is_org_member(organization_id))
    WITH CHECK (is_org_member(organization_id));

-- Clients Policy
DROP POLICY IF EXISTS "Tenant isolation for clients" ON public.clients;
CREATE POLICY "Org-scoped access for clients" ON public.clients
    FOR ALL USING (is_org_member(organization_id))
    WITH CHECK (is_org_member(organization_id));

-- Leads Policy
DROP POLICY IF EXISTS "Tenant isolation for leads" ON public.leads;
CREATE POLICY "Org-scoped access for leads" ON public.leads
    FOR ALL USING (is_org_member(organization_id))
    WITH CHECK (is_org_member(organization_id));

-- Junction and other tables
DROP POLICY IF EXISTS "Tenant isolation for client_leads" ON public.client_leads;
CREATE POLICY "Org-scoped access for client_leads" ON public.client_leads
    FOR ALL USING (is_org_member(workspace_id)) -- client_leads still uses workspace_id as primary link
    WITH CHECK (is_org_member(workspace_id));

-- Instagram and Google Integrations
DROP POLICY IF EXISTS "Tenant isolation for google_integrations" ON public.google_integrations;
CREATE POLICY "Org-scoped access for google_integrations" ON public.google_integrations
    FOR ALL USING (is_org_member(organization_id))
    WITH CHECK (is_org_member(organization_id));

DROP POLICY IF EXISTS "Tenant isolation for instagram_integrations" ON public.instagram_integrations;
CREATE POLICY "Org-scoped access for instagram_integrations" ON public.instagram_integrations
    FOR ALL USING (is_org_member(organization_id))
    WITH CHECK (is_org_member(organization_id));

-- Users table update
DROP POLICY IF EXISTS "Users can read self and workspace members" ON public.users;
CREATE POLICY "Users can read self and team members" ON public.users
    FOR SELECT USING (
        id = auth.uid()::text
        OR organization_id IN (SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()::text)
    );
