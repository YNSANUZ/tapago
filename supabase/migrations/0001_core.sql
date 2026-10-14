create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 80),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  group_type text not null check (group_type in ('fee', 'household', 'other', 'personal')),
  name text not null check (length(trim(name)) between 1 and 80),
  description text not null default '' check (length(description) <= 240),
  due_day smallint check (due_day between 1 and 31),
  pix_key text check (length(pix_key) <= 160),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.group_memberships (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'participant')),
  active boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.group_participants (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 80),
  amount_cents integer not null default 0 check (amount_cents >= 0),
  linked_user_id uuid references auth.users(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (group_id, id)
);

create unique index if not exists group_participants_one_link_per_group
  on public.group_participants (group_id, linked_user_id)
  where linked_user_id is not null;

create table if not exists public.monthly_contributions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  participant_id uuid not null,
  month_start date not null check (extract(day from month_start) = 1),
  amount_cents integer not null check (amount_cents >= 0),
  confirmed_amount_cents integer check (confirmed_amount_cents >= 0),
  paid_at timestamptz,
  confirmed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (participant_id, month_start),
  foreign key (group_id, participant_id) references public.group_participants(group_id, id) on delete cascade,
  check ((paid_at is null and confirmed_by is null and confirmed_amount_cents is null)
      or (paid_at is not null and confirmed_by is not null and confirmed_amount_cents is not null))
);

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  participant_id uuid references public.group_participants(id) on delete cascade,
  invited_email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id),
  revoked_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check ((accepted_at is null and accepted_by is null) or (accepted_at is not null and accepted_by is not null))
);

create table if not exists public.payment_notices (
  id uuid primary key default gen_random_uuid(),
  contribution_id uuid not null references public.monthly_contributions(id) on delete cascade,
  submitted_by uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  submitted_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  unique (contribution_id, submitted_by),
  check ((status = 'pending' and resolved_at is null and resolved_by is null)
      or (status <> 'pending' and resolved_at is not null and resolved_by is not null))
);

create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  contribution_id uuid not null references public.monthly_contributions(id) on delete restrict,
  event_type text not null check (event_type in ('confirmed', 'reversed')),
  amount_cents integer not null check (amount_cents >= 0),
  occurred_at timestamptz not null default now(),
  actor_id uuid not null references auth.users(id),
  reverses_event_id uuid references public.payment_events(id),
  unique (reverses_event_id),
  check ((event_type = 'reversed' and reverses_event_id is not null)
      or (event_type = 'confirmed' and reverses_event_id is null))
);

create table if not exists public.expense_templates (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  amount_cents integer not null check (amount_cents >= 0),
  due_day smallint not null check (due_day between 1 and 31),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.expense_occurrences (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expense_templates(id) on delete restrict,
  month_start date not null check (extract(day from month_start) = 1),
  due_date date not null,
  amount_cents integer not null check (amount_cents >= 0),
  status text not null default 'pending' check (status in ('pending', 'paid')),
  paid_at timestamptz,
  confirmed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (expense_id, month_start),
  check ((status = 'pending' and paid_at is null and confirmed_by is null)
      or (status = 'paid' and paid_at is not null and confirmed_by is not null))
);

create table if not exists public.public_shares (
  group_id uuid primary key references public.groups(id) on delete cascade,
  slug text not null unique,
  enabled boolean not null default false,
  include_pix boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists memberships_user_active on public.group_memberships (user_id, active);
create index if not exists participants_group_active on public.group_participants (group_id, active);
create index if not exists contributions_group_month on public.monthly_contributions (group_id, month_start);
create index if not exists notices_status on public.payment_notices (status, submitted_at);
create index if not exists expense_occurrences_month on public.expense_occurrences (month_start, due_date);

create or replace function public.is_group_member(p_group_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_memberships m
    where m.group_id = p_group_id and m.user_id = auth.uid() and m.active
  );
$$;

create or replace function public.is_group_admin(p_group_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_memberships m
    where m.group_id = p_group_id and m.user_id = auth.uid() and m.active and m.role = 'admin'
  );
$$;

create or replace function public.shares_group_with(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_memberships mine
    join public.group_memberships theirs on theirs.group_id = mine.group_id and theirs.active
    where mine.user_id = auth.uid() and mine.active and theirs.user_id = p_user_id
  );
$$;

create or replace function public.create_group(
  p_group_type text,
  p_name text,
  p_description text default '',
  p_due_day smallint default null,
  p_pix_key text default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  new_group_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_group_type not in ('fee', 'household', 'other', 'personal') then raise exception 'invalid group type'; end if;
  insert into public.groups (group_type, name, description, due_day, pix_key, created_by)
  values (p_group_type, trim(p_name), coalesce(p_description, ''), p_due_day, nullif(trim(p_pix_key), ''), auth.uid())
  returning id into new_group_id;
  insert into public.group_memberships (group_id, user_id, role) values (new_group_id, auth.uid(), 'admin');
  return new_group_id;
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, display_name, avatar_url)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), nullif(split_part(new.email, '@', 1), ''), 'Pessoa'),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (user_id) do update set
    display_name = excluded.display_name,
    avatar_url = excluded.avatar_url,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_tapago on auth.users;
create trigger on_auth_user_created_tapago
after insert or update of raw_user_meta_data on auth.users
for each row execute function public.handle_new_auth_user();

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_memberships enable row level security;
alter table public.group_participants enable row level security;
alter table public.monthly_contributions enable row level security;
alter table public.invitations enable row level security;
alter table public.payment_notices enable row level security;
alter table public.payment_events enable row level security;
alter table public.expense_templates enable row level security;
alter table public.expense_occurrences enable row level security;
alter table public.public_shares enable row level security;

create policy profiles_select_own_or_group on public.profiles for select to authenticated
  using (user_id = auth.uid() or public.shares_group_with(user_id));
create policy profiles_update_own on public.profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy groups_select_member on public.groups for select to authenticated
  using (public.is_group_member(id));
create policy groups_update_admin on public.groups for update to authenticated
  using (public.is_group_admin(id)) with check (public.is_group_admin(id));

create policy memberships_select_group on public.group_memberships for select to authenticated
  using (user_id = auth.uid() or public.is_group_member(group_id));

create policy participants_select_group on public.group_participants for select to authenticated
  using (public.is_group_member(group_id));
create policy participants_admin_insert on public.group_participants for insert to authenticated
  with check (public.is_group_admin(group_id));
create policy participants_admin_update on public.group_participants for update to authenticated
  using (public.is_group_admin(group_id)) with check (public.is_group_admin(group_id));

create policy contributions_select_group on public.monthly_contributions for select to authenticated
  using (public.is_group_member(group_id));

create policy invitations_admin_select on public.invitations for select to authenticated
  using (public.is_group_admin(group_id));

create policy notices_select_own_or_admin on public.payment_notices for select to authenticated
  using (submitted_by = auth.uid() or exists (
    select 1 from public.monthly_contributions c
    where c.id = contribution_id and public.is_group_admin(c.group_id)
  ));
create policy notices_insert_own_linked_member on public.payment_notices for insert to authenticated
  with check (
    submitted_by = auth.uid()
    and exists (
      select 1 from public.monthly_contributions c
      join public.group_participants p on p.id = c.participant_id and p.group_id = c.group_id
      where c.id = contribution_id and p.linked_user_id = auth.uid() and public.is_group_member(c.group_id)
    )
  );
create policy notices_update_admin on public.payment_notices for update to authenticated
  using (exists (
    select 1 from public.monthly_contributions c
    where c.id = contribution_id and public.is_group_admin(c.group_id)
  )) with check (exists (
    select 1 from public.monthly_contributions c
    where c.id = contribution_id and public.is_group_admin(c.group_id)
  ));

create policy payment_events_select_group on public.payment_events for select to authenticated
  using (exists (
    select 1 from public.monthly_contributions c
    where c.id = contribution_id and public.is_group_member(c.group_id)
  ));

create policy expense_templates_select_group on public.expense_templates for select to authenticated
  using (public.is_group_member(group_id));
create policy expense_templates_admin_write on public.expense_templates for all to authenticated
  using (public.is_group_admin(group_id)) with check (public.is_group_admin(group_id));

create policy expense_occurrences_select_member on public.expense_occurrences for select to authenticated
  using (exists (
    select 1 from public.expense_templates e
    where e.id = expense_id and public.is_group_member(e.group_id)
  ));

grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant execute on function public.is_group_member(uuid), public.is_group_admin(uuid), public.shares_group_with(uuid) to authenticated;
grant execute on function public.create_group(text, text, text, smallint, text) to authenticated;
grant select on public.profiles, public.groups, public.group_memberships, public.group_participants,
  public.monthly_contributions, public.invitations, public.payment_notices, public.payment_events,
  public.expense_templates, public.expense_occurrences to authenticated;
grant update (display_name, avatar_url, updated_at) on public.profiles to authenticated;
grant update (name, description, due_day, pix_key, updated_at) on public.groups to authenticated;
grant insert (group_id, display_name, amount_cents, active), update (display_name, amount_cents, active)
  on public.group_participants to authenticated;
grant insert (group_id, name, amount_cents, due_day, active), update (name, amount_cents, due_day, active)
  on public.expense_templates to authenticated;
grant insert (contribution_id, submitted_by) on public.payment_notices to authenticated;
