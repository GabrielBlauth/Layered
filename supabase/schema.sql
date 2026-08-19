-- ============================================================
-- LAYERED — Supabase schema
-- Run this in the Supabase SQL Editor (Project → SQL Editor → New query)
-- ============================================================

-- ------------------------------------------------------------
-- 1. ITEMS — every piece of clothing a user has added
-- ------------------------------------------------------------
create table public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null check (category in ('top', 'bottom', 'shoes', 'jacket', 'head', 'accessory')),
  color text,
  style text,
  image_url text not null,
  created_at timestamptz not null default now()
);

create index items_user_id_idx on public.items(user_id);
create index items_category_idx on public.items(category);

-- ------------------------------------------------------------
-- 2. OUTFITS — a saved combination (the "look")
-- ------------------------------------------------------------
create table public.outfits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Outfit',
  created_at timestamptz not null default now()
);

create index outfits_user_id_idx on public.outfits(user_id);

-- ------------------------------------------------------------
-- 3. OUTFIT_ITEMS — join table: which items belong to which outfit
--    (one row per category slot filled in an outfit)
-- ------------------------------------------------------------
create table public.outfit_items (
  id uuid primary key default gen_random_uuid(),
  outfit_id uuid not null references public.outfits(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  category text not null check (category in ('top', 'bottom', 'shoes', 'jacket', 'head', 'accessory')),
  unique (outfit_id, category) -- one item per category, per outfit
);

create index outfit_items_outfit_id_idx on public.outfit_items(outfit_id);
create index outfit_items_item_id_idx on public.outfit_items(item_id);

-- ============================================================
-- ROW LEVEL SECURITY — each user can only see/edit their own data
-- ============================================================

alter table public.items enable row level security;
alter table public.outfits enable row level security;
alter table public.outfit_items enable row level security;

-- ---- items policies ----
create policy "Users can view their own items"
  on public.items for select
  using (auth.uid() = user_id);

create policy "Users can insert their own items"
  on public.items for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own items"
  on public.items for update
  using (auth.uid() = user_id);

create policy "Users can delete their own items"
  on public.items for delete
  using (auth.uid() = user_id);

-- ---- outfits policies ----
create policy "Users can view their own outfits"
  on public.outfits for select
  using (auth.uid() = user_id);

create policy "Users can insert their own outfits"
  on public.outfits for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own outfits"
  on public.outfits for update
  using (auth.uid() = user_id);

create policy "Users can delete their own outfits"
  on public.outfits for delete
  using (auth.uid() = user_id);

-- ---- outfit_items policies ----
-- access is checked through the parent outfit's owner, since this table
-- has no user_id column of its own
create policy "Users can view their own outfit items"
  on public.outfit_items for select
  using (
    exists (
      select 1 from public.outfits
      where outfits.id = outfit_items.outfit_id
      and outfits.user_id = auth.uid()
    )
  );

create policy "Users can insert their own outfit items"
  on public.outfit_items for insert
  with check (
    exists (
      select 1 from public.outfits
      where outfits.id = outfit_items.outfit_id
      and outfits.user_id = auth.uid()
    )
  );

create policy "Users can delete their own outfit items"
  on public.outfit_items for delete
  using (
    exists (
      select 1 from public.outfits
      where outfits.id = outfit_items.outfit_id
      and outfits.user_id = auth.uid()
    )
  );

-- ============================================================
-- STORAGE — bucket for closet photos, one folder per user
-- Run this section too; it sets up the bucket + its access policies.
-- Photos will be stored as: closet-photos/{user_id}/{filename}
-- ============================================================

insert into storage.buckets (id, name, public)
values ('closet-photos', 'closet-photos', false)
on conflict (id) do nothing;

create policy "Users can view their own closet photos"
  on storage.objects for select
  using (
    bucket_id = 'closet-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can upload to their own closet folder"
  on storage.objects for insert
  with check (
    bucket_id = 'closet-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete their own closet photos"
  on storage.objects for delete
  using (
    bucket_id = 'closet-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
