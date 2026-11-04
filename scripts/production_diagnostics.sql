-- ==============================================================================
-- DIAGNOSTIC QUERIES: Production Data Inventory
-- Project: dbhvslswvmrwuuzwtxzs
-- ==============================================================================

-- 1. High-level Counts
SELECT 'workspaces' as table_name, count(*) as total_count FROM public.workspaces
UNION ALL
SELECT 'clients', count(*) FROM public.clients
UNION ALL
SELECT 'leads', count(*) FROM public.leads
UNION ALL
SELECT 'users', count(*) FROM public.users
UNION ALL
SELECT 'organizations', count(*) FROM public.organizations;

-- 2. Orphan/NULL organization_id Analysis
SELECT 'workspaces_null_org' as metric, count(*) FROM public.workspaces WHERE organization_id IS NULL
UNION ALL
SELECT 'clients_null_org', count(*) FROM public.clients WHERE organization_id IS NULL
UNION ALL
SELECT 'leads_null_org', count(*) FROM public.leads WHERE organization_id IS NULL;

-- 3. Integrity Check: Records without valid parents
SELECT 'clients_without_workspace' as metric, count(*) FROM public.clients c LEFT JOIN public.workspaces w ON c.workspace_id = w.id WHERE w.id IS NULL
UNION ALL
SELECT 'leads_without_workspace', count(*) FROM public.leads l LEFT JOIN public.workspaces w ON l.workspace_id = w.id WHERE w.id IS NULL
UNION ALL
SELECT 'leads_without_client', count(*) FROM public.leads l LEFT JOIN public.client_leads cl ON l.id = cl.lead_id WHERE cl.client_id IS NULL;

-- 4. Workspace Ownership Mapping Preview
-- This shows which workspaces will be mapped to which organizations based on their owner_id
SELECT 
    w.id as workspace_id, 
    w.name as workspace_name, 
    w.owner_id as owner_id, 
    o.id as found_org_id, 
    o.name as found_org_name,
    tm.role as owner_role_in_org
FROM public.workspaces w
LEFT JOIN public.organizations o ON w.owner_id = o.owner_id
LEFT JOIN public.team_members tm ON tm.user_id = w.owner_id AND tm.organization_id = o.id
WHERE w.organization_id IS NULL;

-- 5. Leads Recovery Preview
-- Shows leads that are currently "hidden" but belong to a workspace that has an owner
SELECT 
    l.id as lead_id, 
    l.full_name, 
    l.workspace_id, 
    w.name as workspace_name, 
    w.owner_id as workspace_owner
FROM public.leads l
JOIN public.workspaces w ON l.workspace_id = w.id
WHERE l.organization_id IS NULL;
