-- Instagram Integrations Table for client-specific OAuth with Workspace RLS
CREATE TABLE IF NOT EXISTS public.instagram_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  instagram_user_id TEXT NOT NULL,
  instagram_username TEXT,
  encrypted_access_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  connection_status TEXT DEFAULT 'Connected' CHECK (connection_status IN ('Connected', 'Expired', 'Error', 'Revoked')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_workspace_instagram_client UNIQUE(workspace_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_instagram_integrations_workspace ON public.instagram_integrations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_instagram_integrations_client ON public.instagram_integrations(client_id);

ALTER TABLE public.instagram_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workspace isolation for instagram_integrations" ON public.instagram_integrations
  FOR ALL USING (
    workspace_id = (SELECT workspace_id FROM public.users WHERE id = auth.uid())
    AND client_id IN (SELECT id FROM public.clients WHERE workspace_id = (SELECT workspace_id FROM public.users WHERE id = auth.uid()))
  );

-- Revoke all access from unauthenticated anon role
REVOKE ALL ON public.instagram_integrations FROM anon;

-- Restrict authenticated client users to non-sensitive status columns (encrypted_access_token is never readable by frontend)
REVOKE ALL ON public.instagram_integrations FROM authenticated;
GRANT SELECT (id, workspace_id, client_id, instagram_user_id, instagram_username, connection_status, token_expires_at, created_at, updated_at)
  ON public.instagram_integrations TO authenticated;

-- Service role maintains full access for backend token encryption/decryption
GRANT ALL ON public.instagram_integrations TO service_role;
