-- ==============================================================================
-- REFINED BACKFILL MIGRATION: 20261103_v2_safe_data_backfill.sql
-- Description: Idempotently backfills organization_id using verified ownership mappings.
-- Project: dbhvslswvmrwuuzwtxzs
-- ==============================================================================

BEGIN;

-- 1. Create a log table for unresolved records (if not exists)
CREATE TABLE IF NOT EXISTS public._migration_unresolved_records (
    record_type TEXT,
    record_id UUID,
    workspace_id UUID,
    reason TEXT,
    detected_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Backfill Workspaces via Owner Organization
-- Maps workspace to organization if the workspace owner is an owner of an organization
DO $$
DECLARE
    updated_count INTEGER := 0;
BEGIN
    WITH mapping AS (
        SELECT w.id as ws_id, o.id as org_id
        FROM public.workspaces w
        JOIN public.organizations o ON w.owner_id = o.owner_id
        WHERE w.organization_id IS NULL
    )
    UPDATE public.workspaces ws
    SET organization_id = mapping.org_id
    FROM mapping
    WHERE ws.id = mapping.ws_id;
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE 'Updated % workspaces with organization_id via owner mapping.', updated_count;
END $$;

-- 3. Backfill Clients via Workspace Organization
DO $$
DECLARE
    updated_count INTEGER := 0;
BEGIN
    WITH mapping AS (
        SELECT c.id as client_id, w.organization_id as org_id
        FROM public.clients c
        JOIN public.workspaces w ON c.workspace_id = w.id
        WHERE c.organization_id IS NULL AND w.organization_id IS NOT NULL
    )
    UPDATE public.clients cl
    SET organization_id = mapping.org_id
    FROM mapping
    WHERE cl.id = mapping.client_id;
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE 'Updated % clients with organization_id via workspace mapping.', updated_count;
END $$;

-- 4. Backfill Leads via Workspace Organization
DO $$
DECLARE
    updated_count INTEGER := 0;
BEGIN
    WITH mapping AS (
        SELECT l.id as lead_id, w.organization_id as org_id
        FROM public.leads l
        JOIN public.workspaces w ON l.workspace_id = w.id
        WHERE l.organization_id IS NULL AND w.organization_id IS NOT NULL
    )
    UPDATE public.leads ld
    SET organization_id = mapping.org_id
    FROM mapping
    WHERE ld.id = mapping.lead_id;
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE 'Updated % leads with organization_id via workspace mapping.', updated_count;
END $$;

-- 5. Propagate to other tables
UPDATE public.lead_searches s SET organization_id = w.organization_id FROM public.workspaces w WHERE s.workspace_id = w.id AND s.organization_id IS NULL AND w.organization_id IS NOT NULL;
UPDATE public.client_leads cl SET organization_id = w.organization_id FROM public.workspaces w WHERE cl.workspace_id = w.id AND cl.organization_id IS NULL AND w.organization_id IS NOT NULL;
UPDATE public.google_integrations gi SET organization_id = w.organization_id FROM public.workspaces w WHERE gi.workspace_id = w.id AND gi.organization_id IS NULL AND w.organization_id IS NOT NULL;
UPDATE public.export_history eh SET organization_id = w.organization_id FROM public.workspaces w WHERE eh.workspace_id = w.id AND eh.organization_id IS NULL AND w.organization_id IS NOT NULL;

-- 6. Log unresolved records for manual intervention
INSERT INTO public._migration_unresolved_records (record_type, record_id, workspace_id, reason)
SELECT 'lead', id, workspace_id, 'No organization associated with workspace'
FROM public.leads WHERE organization_id IS NULL;

INSERT INTO public._migration_unresolved_records (record_type, record_id, workspace_id, reason)
SELECT 'client', id, workspace_id, 'No organization associated with workspace'
FROM public.clients WHERE organization_id IS NULL;

-- 7. Verification Summary
-- The user should run the diagnostics query again after execution.

COMMIT;
