-- Fictional staging seed (MUY-46). No real testimonies, people or publishers. Safe to rerun.
-- Real records are seeded only after a person records rights approval (MUY-43); never from here.
INSERT INTO public.sources (id, name, homepage_url, rights_status, private_import_notes)
VALUES
  ('00000000-0000-4000-8000-0000000000e1', 'Fictional staging source (approved)',
   'https://example.invalid/', 'approved', 'synthetic fixture; not a real publisher'),
  ('00000000-0000-4000-8000-0000000000e2', 'Fictional staging source (rights pending)',
   'https://example.invalid/pending', 'pending', 'synthetic fixture; rights not reviewed')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.testimonies
  (id, source_id, external_id, content_hash, title, excerpt, source_name, source_url, topics,
   review_status, rights_status, publication_status, published_at)
VALUES
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000e1', 'synthetic-1',
   'staging-synthetic-1', '[SYNTHETIC] A fictional story of finding peace',
   'A made-up summary used only to test the feed.', 'Fictional staging source (approved)',
   'https://example.invalid/story/1', ARRAY['peace'],
   'approved', 'approved', 'published', '2026-11-01T00:00:00Z'),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000e1', 'synthetic-2',
   'staging-synthetic-2', '[SYNTHETIC] A fictional story of a hard season',
   'Another made-up summary used only to test the feed.', 'Fictional staging source (approved)',
   'https://example.invalid/story/2', ARRAY['hope'],
   'approved', 'approved', 'published', '2026-11-02T00:00:00Z'),
  ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000e2', 'synthetic-3',
   'staging-synthetic-3', '[SYNTHETIC] An unreviewed draft that must stay hidden',
   'Must never be visible to a public user.', 'Fictional staging source (rights pending)',
   'https://example.invalid/story/3', ARRAY[]::text[],
   'pending', 'pending', 'draft', NULL)
ON CONFLICT (id) DO NOTHING;
