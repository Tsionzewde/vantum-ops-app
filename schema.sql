-- VANTUM OPS — Supabase schema
-- Run this in the Supabase SQL editor for your project.

create extension if not exists "pgcrypto";

create table if not exists projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  goal        text,
  team        text,
  steps       jsonb default '[]'::jsonb,
  resources   jsonb default '[]'::jsonb,
  map_data    jsonb default '{}'::jsonb,
  status      text default 'Approved',
  created_at  timestamptz default now()
);

-- Row Level Security: open read/write via the anon key (trusted-team setup).
-- Tighten these policies if you add authentication later.
alter table projects enable row level security;

create policy "anon read"   on projects for select using (true);
create policy "anon insert" on projects for insert with check (true);
create policy "anon update" on projects for update using (true) with check (true);
create policy "anon delete" on projects for delete using (true);
