-- Migration: 20261102_fix_missing_enrichment_columns.sql
-- Description: Ensures all lead enrichment and metadata columns exist for complete persistence.
-- This is a safety migration to fix production environments where previous migrations might have failed or been skipped.

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

-- Re-create the unique constraint just in case
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_workspace_profile_url') THEN
        ALTER TABLE public.leads ADD CONSTRAINT unique_workspace_profile_url UNIQUE(workspace_id, profile_url);
    END IF;
END $$;
