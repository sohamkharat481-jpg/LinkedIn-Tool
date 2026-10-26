-- Migration: 20261026_fix_data_persistence_and_text_uids.sql
-- Description: Ensures users.id and workspaces.owner_id support Firebase string UIDs without type mismatch,
-- and ensures all lead enrichment and metadata columns exist for complete persistence.

-- 1. Ensure workspaces.owner_id is TEXT (to support Firebase string UIDs like '5ya6ApT79GS7nzlvCBWxwneuOV13')
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'workspaces' AND column_name = 'owner_id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE public.workspaces ALTER COLUMN owner_id TYPE TEXT USING owner_id::TEXT;
  ELSE
    ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS owner_id TEXT;
  END IF;
END $$;

-- 2. Ensure users.id supports TEXT identifiers (Firebase Auth UIDs)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_created_by_fkey;
    ALTER TABLE public.users ALTER COLUMN id TYPE TEXT USING id::TEXT;
    ALTER TABLE public.clients ALTER COLUMN created_by TYPE TEXT USING created_by::TEXT;
  END IF;
END $$;

-- 3. Ensure all leads columns exist
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS lead_type TEXT,
  ADD COLUMN IF NOT EXISTS business_category TEXT,
  ADD COLUMN IF NOT EXISTS business_website TEXT,
  ADD COLUMN IF NOT EXISTS business_phone TEXT,
  ADD COLUMN IF NOT EXISTS business_address TEXT,
  ADD COLUMN IF NOT EXISTS business_city TEXT,
  ADD COLUMN IF NOT EXISTS business_country TEXT,
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS business_email TEXT,
  ADD COLUMN IF NOT EXISTS linkedin_profile_url TEXT,
  ADD COLUMN IF NOT EXISTS contact_source TEXT,
  ADD COLUMN IF NOT EXISTS contact_verification_status TEXT,
  ADD COLUMN IF NOT EXISTS instagram_username TEXT,
  ADD COLUMN IF NOT EXISTS instagram_profile_url TEXT,
  ADD COLUMN IF NOT EXISTS instagram_verification_status TEXT,
  ADD COLUMN IF NOT EXISTS instagram_verification_evidence TEXT,
  ADD COLUMN IF NOT EXISTS instagram_discovery_source TEXT,
  ADD COLUMN IF NOT EXISTS instagram_last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS relevance_score DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS relevance_explanation TEXT,
  ADD COLUMN IF NOT EXISTS relevance_breakdown JSONB,
  ADD COLUMN IF NOT EXISTS b2b_classification TEXT,
  ADD COLUMN IF NOT EXISTS is_deceased BOOLEAN,
  ADD COLUMN IF NOT EXISTS date_of_death TEXT,
  ADD COLUMN IF NOT EXISTS date_of_birth TEXT,
  ADD COLUMN IF NOT EXISTS entity_period TEXT,
  ADD COLUMN IF NOT EXISTS active_evidence TEXT;

-- 4. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_workspaces_owner_text ON public.workspaces(owner_id);
CREATE INDEX IF NOT EXISTS idx_leads_workspace_profile ON public.leads(workspace_id, profile_url);
CREATE INDEX IF NOT EXISTS idx_client_leads_lookup ON public.client_leads(workspace_id, client_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_searches_lookup ON public.lead_searches(workspace_id, client_id);
