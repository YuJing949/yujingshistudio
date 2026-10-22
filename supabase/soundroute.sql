-- SoundRoute / Parrot — database setup
-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to re-run: every statement checks whether its object already exists.
--
-- Before running: Authentication → Sign In / Providers → turn on "Allow anonymous sign-ins".

-- ─────────────────────────────────────────────
-- 1. Tables
-- ─────────────────────────────────────────────

-- One walk = one route = one continuous audio file (max 5 minutes).
create table if not exists public.routes (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null default 'Untitled walk' check (char_length(name) <= 80),
  is_public   boolean not null default false,
  share_code  text unique,
  duration_s  real check (duration_s is null or duration_s <= 330),
  audio_path  text,              -- path inside the "route-audio" bucket
  audio_mime  text,
  center_lat  double precision,  -- average of the route's points, used for the plaza grid
  center_lng  double precision,
  created_at  timestamptz not null default now()
);

-- A track point every ~2 seconds. `t` = seconds since the recording started,
-- so playback can jump to the matching moment in the audio file.
create table if not exists public.points (
  id        bigint generated always as identity primary key,
  route_id  uuid not null references public.routes (id) on delete cascade,
  t         real not null check (t >= 0),
  lat       double precision not null check (lat between -90 and 90),
  lng       double precision not null check (lng between -180 and 180),
  heading   real,
  accuracy  real
);
create index if not exists points_route_id_idx on public.points (route_id, t);

-- "My map → saved walks". Only saved routes (plus your own) play while walking.
create table if not exists public.saves (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  route_id   uuid not null references public.routes (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, route_id)
);
create index if not exists saves_route_id_idx on public.saves (route_id);

-- ─────────────────────────────────────────────
-- 2. Share codes, e.g. "misty-parrot-0417"
-- ─────────────────────────────────────────────

create or replace function public.make_share_code()
returns text
language plpgsql
set search_path = public
as $$
declare
  adjectives text[] := array['misty','quiet','amber','lost','slow','green','silver','windy',
                             'hidden','soft','early','late','rainy','sunny','velvet','echo'];
  nouns      text[] := array['parrot','umbrella','street','bridge','corner','river','lamp','gate',
                             'garden','bench','alley','station','square','canal','window','path'];
  candidate  text;
begin
  loop
    candidate := adjectives[1 + floor(random() * array_length(adjectives, 1))::int]
              || '-' || nouns[1 + floor(random() * array_length(nouns, 1))::int]
              || '-' || lpad(floor(random() * 10000)::int::text, 4, '0');
    exit when not exists (select 1 from public.routes where share_code = candidate);
  end loop;
  return candidate;
end;
$$;

create or replace function public.routes_set_share_code()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.share_code is null then
    new.share_code := public.make_share_code();
  end if;
  return new;
end;
$$;

drop trigger if exists routes_share_code on public.routes;
create trigger routes_share_code
  before insert on public.routes
  for each row execute function public.routes_set_share_code();

-- ─────────────────────────────────────────────
-- 3. Who can see what (Row Level Security)
-- ─────────────────────────────────────────────

alter table public.routes enable row level security;
alter table public.points enable row level security;
alter table public.saves  enable row level security;

-- Routes: you see your own, public ones, and ones you have saved.
drop policy if exists "routes: read" on public.routes;
create policy "routes: read" on public.routes for select to authenticated
  using (
    owner = auth.uid()
    or is_public
    or exists (select 1 from public.saves s where s.route_id = id and s.user_id = auth.uid())
  );

drop policy if exists "routes: insert own" on public.routes;
create policy "routes: insert own" on public.routes for insert to authenticated
  with check (owner = auth.uid());

drop policy if exists "routes: update own" on public.routes;
create policy "routes: update own" on public.routes for update to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

drop policy if exists "routes: delete own" on public.routes;
create policy "routes: delete own" on public.routes for delete to authenticated
  using (owner = auth.uid());

-- Points follow their route: readable whenever the route is readable.
drop policy if exists "points: read" on public.points;
create policy "points: read" on public.points for select to authenticated
  using (exists (select 1 from public.routes r where r.id = route_id));

drop policy if exists "points: insert own" on public.points;
create policy "points: insert own" on public.points for insert to authenticated
  with check (exists (select 1 from public.routes r where r.id = route_id and r.owner = auth.uid()));

drop policy if exists "points: delete own" on public.points;
create policy "points: delete own" on public.points for delete to authenticated
  using (exists (select 1 from public.routes r where r.id = route_id and r.owner = auth.uid()));

-- Saves: only your own list. Directly you can save public routes;
-- private routes are saved through save_by_code() below.
drop policy if exists "saves: read own" on public.saves;
create policy "saves: read own" on public.saves for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "saves: insert public" on public.saves;
create policy "saves: insert public" on public.saves for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.routes r where r.id = route_id and r.is_public)
  );

drop policy if exists "saves: delete own" on public.saves;
create policy "saves: delete own" on public.saves for delete to authenticated
  using (user_id = auth.uid());

-- ─────────────────────────────────────────────
-- 4. Save any route (public or private) by its share code
-- ─────────────────────────────────────────────

create or replace function public.save_by_code(code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  found_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  select id into found_id from public.routes where share_code = lower(trim(code));
  if found_id is null then
    raise exception 'no walk with that code';
  end if;
  insert into public.saves (user_id, route_id) values (auth.uid(), found_id)
  on conflict do nothing;
  return found_id;
end;
$$;

revoke all on function public.save_by_code(text) from public, anon;
grant execute on function public.save_by_code(text) to authenticated;

-- ─────────────────────────────────────────────
-- 5. City plaza: public routes counted on a ~200 m grid (no exact locations)
-- ─────────────────────────────────────────────

create or replace function public.get_plaza_cells()
returns table (lat double precision, lng double precision, walks integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    (floor(center_lat / 0.0018) + 0.5) * 0.0018 as lat,
    (floor(center_lng / 0.0029) + 0.5) * 0.0029 as lng,
    count(*)::int as walks
  from public.routes
  where is_public and center_lat is not null and center_lng is not null
  group by 1, 2;
$$;

grant execute on function public.get_plaza_cells() to anon, authenticated;

-- ─────────────────────────────────────────────
-- 6. Audio storage
-- ─────────────────────────────────────────────

-- Private bucket; files are read through short-lived signed URLs.
-- Each file is at most 10 MB (5 minutes at a low bitrate is about 1–2 MB).
insert into storage.buckets (id, name, public, file_size_limit)
values ('route-audio', 'route-audio', false, 10485760)
on conflict (id) do nothing;

-- Upload and delete only inside your own folder: "<your user id>/<route id>.<ext>"
drop policy if exists "route-audio: upload own" on storage.objects;
create policy "route-audio: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'route-audio' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "route-audio: delete own" on storage.objects;
create policy "route-audio: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'route-audio' and (storage.foldername(name))[1] = auth.uid()::text);

-- Read: whenever you can read the route that points to this file.
drop policy if exists "route-audio: read visible" on storage.objects;
create policy "route-audio: read visible" on storage.objects for select to authenticated
  using (
    bucket_id = 'route-audio'
    and exists (select 1 from public.routes r where r.audio_path = storage.objects.name)
  );

-- ═════════════════════════════════════════════
-- Phase 7: reports, automatic hiding, daily limits
-- ═════════════════════════════════════════════

-- A walk reported by 3 different people is hidden from everyone but its
-- owner until you review it (Table Editor → routes → hidden).
alter table public.routes add column if not exists hidden boolean not null default false;

create table if not exists public.reports (
  route_id   uuid not null references public.routes (id) on delete cascade,
  reporter   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reason     text check (reason is null or char_length(reason) <= 300),
  created_at timestamptz not null default now(),
  primary key (route_id, reporter)
);
alter table public.reports enable row level security;

-- Anyone signed in can report a walk they can see (not their own).
-- Nobody can read reports through the app; review them in the dashboard.
drop policy if exists "reports: insert" on public.reports;
create policy "reports: insert" on public.reports for insert to authenticated
  with check (
    reporter = auth.uid()
    and exists (select 1 from public.routes r where r.id = route_id and r.owner <> auth.uid())
  );

create or replace function public.reports_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.reports where route_id = new.route_id) >= 3 then
    update public.routes set hidden = true where id = new.route_id;
  end if;
  return new;
end;
$$;

drop trigger if exists reports_hide on public.reports;
create trigger reports_hide
  after insert on public.reports
  for each row execute function public.reports_after_insert();

-- Daily limits: 30 walks and 20 reports per person per day.
create or replace function public.limit_daily_routes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.routes
      where owner = new.owner and id <> new.id and created_at > now() - interval '1 day') >= 30 then
    raise exception 'Daily limit reached: 30 walks a day. Try again tomorrow.';
  end if;
  return new;
end;
$$;

drop trigger if exists routes_daily_limit on public.routes;
create trigger routes_daily_limit
  before insert on public.routes
  for each row execute function public.limit_daily_routes();

create or replace function public.limit_daily_reports()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.reports
      where reporter = new.reporter and created_at > now() - interval '1 day') >= 20 then
    raise exception 'Daily limit reached: 20 reports a day.';
  end if;
  return new;
end;
$$;

drop trigger if exists reports_daily_limit on public.reports;
create trigger reports_daily_limit
  before insert on public.reports
  for each row execute function public.limit_daily_reports();

-- Hidden walks: only the owner still sees them.
drop policy if exists "routes: read" on public.routes;
create policy "routes: read" on public.routes for select to authenticated
  using (
    owner = auth.uid()
    or (
      not hidden
      and (
        is_public
        or exists (select 1 from public.saves s where s.route_id = id and s.user_id = auth.uid())
      )
    )
  );

drop policy if exists "saves: insert public" on public.saves;
create policy "saves: insert public" on public.saves for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.routes r where r.id = route_id and r.is_public and not r.hidden)
  );

create or replace function public.save_by_code(code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  found_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  select id into found_id from public.routes
  where share_code = lower(trim(code)) and (not hidden or owner = auth.uid());
  if found_id is null then
    raise exception 'no walk with that code';
  end if;
  insert into public.saves (user_id, route_id) values (auth.uid(), found_id)
  on conflict do nothing;
  return found_id;
end;
$$;

create or replace function public.get_plaza_cells()
returns table (lat double precision, lng double precision, walks integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    (floor(center_lat / 0.0018) + 0.5) * 0.0018 as lat,
    (floor(center_lng / 0.0029) + 0.5) * 0.0029 as lng,
    count(*)::int as walks
  from public.routes
  where is_public and not hidden and center_lat is not null and center_lng is not null
  group by 1, 2;
$$;
