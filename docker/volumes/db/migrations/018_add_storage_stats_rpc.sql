-- Migration 018: Aggregate active file usage by book for the storage manager.
--
-- The Readest API calls this function with its service-role client. Keeping the
-- aggregation in PostgreSQL avoids transferring every matching files row to
-- the Node.js process. Quoted output columns preserve the camelCase response
-- shape consumed by the existing API.

CREATE OR REPLACE FUNCTION public.get_storage_by_book_hash(p_user_id uuid)
RETURNS TABLE (
  "bookHash" text,
  "fileCount" bigint,
  "totalSize" bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    f.book_hash AS "bookHash",
    count(*)::bigint AS "fileCount",
    COALESCE(sum(f.file_size), 0)::bigint AS "totalSize"
  FROM public.files AS f
  WHERE f.user_id = p_user_id
    AND f.deleted_at IS NULL
  GROUP BY f.book_hash
  ORDER BY "totalSize" DESC;
$$;

REVOKE ALL ON FUNCTION public.get_storage_by_book_hash(uuid) FROM PUBLIC;
GRANT SELECT ON public.files TO service_role;
GRANT EXECUTE ON FUNCTION public.get_storage_by_book_hash(uuid) TO service_role;
