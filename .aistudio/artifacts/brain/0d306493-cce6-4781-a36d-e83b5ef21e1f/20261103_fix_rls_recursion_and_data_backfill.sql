-- ==============================================================================
-- Migration: 20261103_fix_rls_recursion_and_data_backfill.sql
-- Description: Fix recursive RLS on users table and backfill missing organization_ids
-- Project: dbhvslswvmrwuuzwtxzs
-- ==============================================================================

-- 1. Recursion-Proof Helper for User Workspace
-- This function allows RLS policies to check the current user's workspace without querying the users table directly, which prevents infinite recursion.
CREATE OR REPLACE FUNCTION public.get_user_workspace_id(u_id TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN (SELECT workspace_id FROM public.users WHERE id = u_id LIMIT 1);
END;
$$;

-- Explicitly restrict execution to authenticated users and service role
REVOKE ALL ON FUNCTION public.get_user_workspace_id(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_workspace_id(TEXT) TO authenticated, service_role;

-- 2. Fix Recursive RLS on public.users
-- Updating the SELECT policy to use the recursion-proof helper function.
DROP POLICY IF EXISTS "Users can read self and team members" ON public.users;
CREATE POLICY "Users can read self and team members" ON public.users
    FOR SELECT USING (
        id = auth.uid()::text
        OR (organization_id IS NOT NULL AND public.is_org_member(organization_id))
        OR (workspace_id = public.get_user_workspace_id(auth.uid()::text))
    );

-- 3. Robust Data Backfill for approximately 157 leads and hidden clients
-- This block ensures that every workspace and its associated records have a valid organization_id.
DO $$
DECLARE
    ws_record RECORD;
    org_id UUID;
BEGIN
    -- Step A: Ensure every workspace has an organization_id if we can find one via owner_id
    FOR ws_record IN (SELECT id, owner_id FROM public.workspaces WHERE organization_id IS NULL AND owner_id IS NOT NULL) LOOP
        -- Try to find org via owner's team membership
        SELECT organization_id INTO org_id FROM public.team_members WHERE user_id = ws_record.owner_id LIMIT 1;
        
        -- Fallback: try to find org where owner is owner
        IF org_id IS NULL THEN
            SELECT id INTO org_id FROM public.organizations WHERE owner_id = ws_record.owner_id LIMIT 1;
        END IF;

        IF org_id IS NOT NULL THEN
            UPDATE public.workspaces SET organization_id = org_id WHERE id = ws_record.id;
        END IF;
    END LOOP;

    -- Step B: Propagate organization_id to all child tables where it's missing but workspace is known
    
    -- Clients
    UPDATE public.clients c
    SET organization_id = w.organization_id
    FROM public.workspaces w
    WHERE c.workspace_id = w.id 
    AND c.organization_id IS NULL 
    AND w.organization_id IS NOT NULL;

    -- Leads (Crucial for recovering the 157 leads)
    UPDATE public.leads l
    SET organization_id = w.organization_id
    FROM public.workspaces w
    WHERE l.workspace_id = w.id 
    AND l.organization_id IS NULL 
    AND w.organization_id IS NOT NULL;

    -- Searches
    UPDATE public.lead_searches s
    SET organization_id = w.organization_id
    FROM public.workspaces w
    WHERE s.workspace_id = w.id 
    AND s.organization_id IS NULL 
    AND w.organization_id IS NOT NULL;

    UPDATE public.search_history sh
    SET organization_id = w.organization_id
    FROM public.workspaces w
    WHERE sh.workspace_id = w.id 
    AND sh.organization_id IS NULL 
    AND w.organization_id IS NOT NULL;

    -- Client Leads Junction
    UPDATE public.client_leads cl
    SET organization_id = w.organization_id
    FROM public.workspaces w
    WHERE cl.workspace_id = w.id 
    AND cl.organization_id IS NULL 
    AND w.organization_id IS NOT NULL;

    -- Google Integrations
    UPDATE public.google_integrations gi
    SET organization_id = w.organization_id
    FROM public.workspaces w
    WHERE gi.workspace_id = w.id 
    AND gi.organization_id IS NULL 
    AND w.organization_id IS NOT NULL;

    -- Export History
    UPDATE public.export_history eh
    SET organization_id = w.organization_id
    FROM public.workspaces w
    WHERE eh.workspace_id = w.id 
    AND eh.organization_id IS NULL 
    AND w.organization_id IS NOT NULL;

END $$;
