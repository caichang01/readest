-- Fork migration 024: allow the upstream Audiobookshelf server replica kind.
-- Preserve all existing kinds and RLS; credentials still use replica encryption.
ALTER TABLE public.replicas
  DROP CONSTRAINT IF EXISTS replicas_kind_allowlist;

ALTER TABLE public.replicas
  ADD CONSTRAINT replicas_kind_allowlist
  CHECK (kind IN ('dictionary', 'font', 'texture', 'opds_catalog', 'settings', 'abs_server'));
