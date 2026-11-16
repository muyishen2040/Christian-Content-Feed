-- Public access is limited to approved metadata, never full testimony bodies.
REVOKE ALL ON public.testimonies FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, source_id, content_type, title, excerpt, source_name, source_url, topics,
  review_status, rights_status, publication_status, published_at
) ON public.testimonies TO anon, authenticated;

-- The explicit filter also applies when a service role bypasses RLS.
CREATE OR REPLACE VIEW public.published_testimonies
WITH (security_invoker = true, security_barrier = true) AS
SELECT id, content_type, title, excerpt, source_name, source_url, topics, published_at
FROM public.testimonies
WHERE review_status = 'approved'
  AND rights_status = 'approved'
  AND publication_status = 'published'
  AND published_at IS NOT NULL
  AND public.is_source_approved(source_id);

REVOKE ALL ON public.published_testimonies FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.published_testimonies TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_source_approved(uuid) TO service_role;
