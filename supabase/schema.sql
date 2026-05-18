-- ImpactAI Supabase Schema
-- Run this in the Supabase SQL editor to set up the database

-- Users table (extends Supabase auth.users)
create table if not exists public.users (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null,
  username text unique not null,
  plan text not null default 'free' check (plan in ('free', 'pro', 'admin')),
  role text not null default 'user',
  avatar_url text,
  streak integer default 0,
  total_swings integer default 0,
  last_active timestamptz default now(),
  created_at timestamptz default now()
);

-- Swings table
create table if not exists public.swings (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  video_url text not null,
  result_json jsonb not null,
  privacy text not null default 'private' check (privacy in ('private', 'friends')),
  created_at timestamptz default now()
);

-- Friends table (bidirectional friendship — both directions stored)
create table if not exists public.friends (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  friend_id uuid references public.users(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique (user_id, friend_id)
);

-- Friend requests table
create table if not exists public.requests (
  id uuid default gen_random_uuid() primary key,
  sender_id uuid references public.users(id) on delete cascade not null,
  receiver_id uuid references public.users(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique (sender_id, receiver_id)
);

-- Row Level Security

alter table public.users enable row level security;
alter table public.swings enable row level security;
alter table public.friends enable row level security;
alter table public.requests enable row level security;

-- Users policies
create policy "Users can view their own profile"
  on public.users for select using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.users for update using (auth.uid() = id);

create policy "Users can view other users (for search)"
  on public.users for select using (true);

create policy "Users can insert their own profile"
  on public.users for insert with check (auth.uid() = id);

-- Swings policies
create policy "Users can view their own swings"
  on public.swings for select using (auth.uid() = user_id);

create policy "Friends can view shared swings"
  on public.swings for select using (
    privacy = 'friends' and
    exists (
      select 1 from public.friends
      where user_id = auth.uid() and friend_id = swings.user_id
    )
  );

create policy "Users can insert their own swings"
  on public.swings for insert with check (auth.uid() = user_id);

create policy "Users can update their own swings"
  on public.swings for update using (auth.uid() = user_id);

-- Friends policies
create policy "Users can view their friends"
  on public.friends for select using (auth.uid() = user_id);

create policy "Users can manage their friends"
  on public.friends for all using (auth.uid() = user_id);

-- Requests policies
create policy "Users can view received requests"
  on public.requests for select using (auth.uid() = receiver_id);

create policy "Users can view sent requests"
  on public.requests for select using (auth.uid() = sender_id);

create policy "Users can send requests"
  on public.requests for insert with check (auth.uid() = sender_id);

create policy "Users can delete requests they sent or received"
  on public.requests for delete using (
    auth.uid() = sender_id or auth.uid() = receiver_id
  );

-- ============================================================
-- MIGRATION — run this in Supabase SQL editor (tables already exist)
-- ============================================================

-- Add new columns to swings
alter table public.swings
  add column if not exists status text not null default 'completed'
    check (status in ('uploaded', 'processing', 'completed', 'failed')),
  add column if not exists club text,
  add column if not exists updated_at timestamptz;

-- Storage bucket: create via Dashboard → Storage → New Bucket
--   Name:   swing-videos
--   Public: true (toggle on)
-- ============================================================

-- Visual Analysis: 4 key frames + coaching labels
alter table public.swings
  add column if not exists visual_analysis jsonb;

-- Phase 1.5: thumbnail + re-analyze columns
alter table public.swings
  add column if not exists thumbnail_url text,
  add column if not exists analysis_version integer not null default 1,
  add column if not exists last_analyzed_at timestamptz;

-- Add overlay columns to swings
alter table public.swings
  add column if not exists overlay_video_url text,
  add column if not exists overlay_status text not null default 'none'
    check (overlay_status in ('none', 'processing', 'completed', 'failed'));

-- Function to update total_swings count
create or replace function update_total_swings()
returns trigger as $$
begin
  update public.users
  set total_swings = (
    select count(*) from public.swings where user_id = new.user_id
  )
  where id = new.user_id;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_swing_insert
  after insert on public.swings
  for each row execute procedure update_total_swings();
