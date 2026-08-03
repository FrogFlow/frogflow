-- === PATCH: Instagram DM Media Attachments ===
-- Создаёт бакет для медиа-вложений в Instagram DM-автоматизациях.
-- Запустить один раз в Supabase SQL Editor.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES (
  'instagram-media',
  'instagram-media',
  true,
  20971520 -- 20MB limit
) ON CONFLICT (id) DO NOTHING;

-- RLS: разрешить service_role всё
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects'
      AND schemaname = 'storage'
      AND policyname = 'Service Role All instagram-media'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "Service Role All instagram-media"
      ON storage.objects FOR ALL TO service_role
      USING (bucket_id = 'instagram-media')
      WITH CHECK (bucket_id = 'instagram-media');
    $pol$;
  END IF;
END;
$$;
