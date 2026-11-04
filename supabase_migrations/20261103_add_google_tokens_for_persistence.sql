-- Migration: 20261103_add_google_tokens_for_persistence.sql
-- Description: Adds encrypted token storage for Google Workspace persistence
-- Project: dbhvslswvmrwuuzwtxzs

CREATE TABLE IF NOT EXISTS public.google_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL, -- Ties to public.users(id)
    organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
    encrypted_refresh_token TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE public.google_tokens ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can manage their own google tokens" ON public.google_tokens;
CREATE POLICY "Users can manage their own google tokens" ON public.google_tokens
    FOR ALL USING (user_id = auth.uid()::text)
    WITH CHECK (user_id = auth.uid()::text);

-- Grant access to service_role for server-side refresh
GRANT ALL ON public.google_tokens TO service_role;
GRANT ALL ON public.google_tokens TO authenticated;
