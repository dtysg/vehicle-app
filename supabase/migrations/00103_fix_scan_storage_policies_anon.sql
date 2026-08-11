
-- 修复 Storage 策略：允许 anon key（非 Supabase Auth）上传和删除
drop policy if exists "scan_images_upload"  on storage.objects;
drop policy if exists "scan_images_delete"  on storage.objects;
drop policy if exists "scan_images_select"  on storage.objects;

create policy "scan_images_all" on storage.objects
  for all to anon
  using  (bucket_id = 'scan-images')
  with check (bucket_id = 'scan-images');
