
-- 文档表（多页扫描的文档容器）
create table scan_documents (
  id          uuid primary key default gen_random_uuid(),
  emp_id      int  not null,
  title       text not null default '未命名文档',
  page_count  int  not null default 0,
  cover_url   text,
  total_chars int  not null default 0,
  created_at  timestamptz not null default now()
);

-- 页面表（每个文档的单页）
create table scan_pages (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references scan_documents(id) on delete cascade,
  page_number  int  not null default 1,
  image_url    text not null,
  filter_type  text not null default 'original',
  ocr_text     text not null default '',
  created_at   timestamptz not null default now()
);

-- 允许匿名访问（应用层自行控制员工权限）
alter table scan_documents enable row level security;
alter table scan_pages     enable row level security;

create policy "scan_docs_all"  on scan_documents for all to anon using (true) with check (true);
create policy "scan_pages_all" on scan_pages     for all to anon using (true) with check (true);

-- Storage bucket for scan images (复用已有 scan-images bucket)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scan-images', 'scan-images', true, 20971520, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit;
