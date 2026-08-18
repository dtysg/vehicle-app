
create table scan_records (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid(),
  title       text not null default '未命名扫描',
  image_url   text,
  text_result text not null default '',
  word_count  int  not null default 0,
  created_at  timestamptz not null default now()
);

alter table scan_records enable row level security;

-- 用户只能读写自己的记录
create policy "scan_records_select" on scan_records
  for select to authenticated using (user_id = auth.uid());

create policy "scan_records_insert" on scan_records
  for insert to authenticated with check (user_id = auth.uid());

create policy "scan_records_delete" on scan_records
  for delete to authenticated using (user_id = auth.uid());

-- 匿名用户无权限（全部拒绝，显式声明）
create policy "scan_records_anon_deny" on scan_records
  for all to anon using (false);

-- Storage bucket for scan images
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scan-images', 'scan-images', true, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "scan_images_upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'scan-images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "scan_images_select" on storage.objects
  for select to public using (bucket_id = 'scan-images');

create policy "scan_images_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'scan-images' and (storage.foldername(name))[1] = auth.uid()::text);
