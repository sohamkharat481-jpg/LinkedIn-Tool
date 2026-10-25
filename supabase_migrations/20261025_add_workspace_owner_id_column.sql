-- Migration: Add owner_id to public.workspaces table for explicit workspace ownership
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS owner_id UUID;

CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON public.workspaces(owner_id);
