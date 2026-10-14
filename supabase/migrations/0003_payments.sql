create table public.participant_amount_versions (
  participant_id uuid not null references public.group_participants(id) on delete cascade,
  effective_month date not null check (extract(day from effective_month) = 1),
  amount_cents integer not null check (amount_cents >= 0),
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now(),
  primary key (participant_id, effective_month)
);

alter table public.payment_notices add column group_id uuid references public.groups(id) on delete cascade;
update public.payment_notices n set group_id = c.group_id from public.monthly_contributions c where c.id = n.contribution_id;
alter table public.payment_notices alter column group_id set not null;
alter table public.payment_events add column group_id uuid references public.groups(id) on delete cascade;
update public.payment_events e set group_id = c.group_id from public.monthly_contributions c where c.id = e.contribution_id;
alter table public.payment_events alter column group_id set not null;
create index payment_notices_group on public.payment_notices (group_id, status, submitted_at);
create index payment_events_group on public.payment_events (group_id, occurred_at desc);

alter table public.participant_amount_versions enable row level security;
create policy amount_versions_member_select on public.participant_amount_versions for select to authenticated
  using (exists (select 1 from public.group_participants p where p.id = participant_id and public.is_group_member(p.group_id)));

drop policy if exists notices_select_own_or_admin on public.payment_notices;
drop policy if exists notices_insert_own_linked_member on public.payment_notices;
drop policy if exists notices_update_admin on public.payment_notices;
create policy notices_select_member on public.payment_notices for select to authenticated
  using (public.is_group_member(group_id));
drop policy if exists payment_events_select_group on public.payment_events;
create policy payment_events_select_group on public.payment_events for select to authenticated
  using (public.is_group_member(group_id));
revoke insert, update, delete on public.monthly_contributions, public.payment_notices, public.payment_events, public.participant_amount_versions from authenticated;
revoke update (amount_cents) on public.group_participants from authenticated;
grant select on public.participant_amount_versions to authenticated;
grant select on public.payment_notices, public.payment_events to authenticated;

create or replace function public.seed_participant_amount_version()
returns trigger language plpgsql security definer set search_path = public
as $$
declare local_month date := date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;
begin
  insert into public.participant_amount_versions (participant_id, effective_month, amount_cents, changed_by)
  values (new.id, local_month, new.amount_cents, coalesce(auth.uid(), (select created_by from public.groups where id = new.group_id)))
  on conflict (participant_id, effective_month) do nothing;
  return new;
end; $$;
create trigger participant_amount_version_seed after insert on public.group_participants
for each row execute function public.seed_participant_amount_version();

create or replace function public.update_contribution_amount(p_group_id uuid, p_participant_id uuid, p_month_start date, p_amount_cents integer)
returns void language plpgsql security definer set search_path = public
as $$
declare current_month date := date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;
begin
  if auth.uid() is null or not public.is_group_admin(p_group_id) then raise exception 'administrator access required' using errcode='42501'; end if;
  if p_month_start is null or extract(day from p_month_start) <> 1 or p_month_start < current_month or p_amount_cents < 0 then raise exception 'invalid amount or effective month' using errcode='22023'; end if;
  if not exists (select 1 from public.group_participants where id=p_participant_id and group_id=p_group_id and active) then raise exception 'participant unavailable' using errcode='22023'; end if;
  if p_month_start = current_month and exists (select 1 from public.monthly_contributions where participant_id=p_participant_id and month_start=p_month_start and paid_at is not null) then raise exception 'confirmed payment cannot be edited' using errcode='22023'; end if;
  insert into public.participant_amount_versions (participant_id,effective_month,amount_cents,changed_by)
  values (p_participant_id,p_month_start,p_amount_cents,auth.uid())
  on conflict (participant_id,effective_month) do update set amount_cents=excluded.amount_cents, changed_by=excluded.changed_by, changed_at=now();
  if p_month_start=current_month then
    update public.monthly_contributions set amount_cents=p_amount_cents, updated_at=now()
    where participant_id=p_participant_id and month_start=p_month_start and paid_at is null;
  end if;
end; $$;

create or replace function public.ensure_contribution_period(p_group_id uuid, p_month_start date)
returns uuid language plpgsql security definer set search_path = public
as $$
declare contribution_id uuid;
begin
  if auth.uid() is null or not public.is_group_member(p_group_id) then raise exception 'group membership required' using errcode='42501'; end if;
  if extract(day from p_month_start) <> 1 or p_month_start > date_trunc('month', now() at time zone 'America/Sao_Paulo')::date then raise exception 'invalid period' using errcode='22023'; end if;
  if not exists (select 1 from public.groups where id=p_group_id and group_type='fee') then raise exception 'not a fee group' using errcode='22023'; end if;
  insert into public.monthly_contributions (group_id,participant_id,month_start,amount_cents)
  select p_group_id,p.id,p_month_start,coalesce(v.amount_cents,p.amount_cents)
  from public.group_participants p
  left join lateral (select amount_cents from public.participant_amount_versions av where av.participant_id=p.id and av.effective_month<=p_month_start order by av.effective_month desc limit 1) v on true
  where p.group_id=p_group_id and p.active
  on conflict (participant_id,month_start) do nothing;
  select id into contribution_id from public.monthly_contributions where group_id=p_group_id and participant_id=(select id from public.group_participants where group_id=p_group_id and linked_user_id=auth.uid() and active limit 1) and month_start=p_month_start;
  return contribution_id;
end; $$;

create or replace function public.submit_payment_notice(p_group_id uuid, p_month_start date)
returns uuid language plpgsql security definer set search_path = public
as $$
declare participant public.group_participants%rowtype; contribution public.monthly_contributions%rowtype; notice_id uuid;
begin
  if auth.uid() is null or not public.is_group_member(p_group_id) then raise exception 'group membership required' using errcode='42501'; end if;
  select * into participant from public.group_participants where group_id=p_group_id and linked_user_id=auth.uid() and active for update;
  if not found then raise exception 'linked participant required' using errcode='42501'; end if;
  perform public.ensure_contribution_period(p_group_id,p_month_start);
  select * into contribution from public.monthly_contributions where group_id=p_group_id and participant_id=participant.id and month_start=p_month_start for update;
  if not found or contribution.paid_at is not null then raise exception 'payment is unavailable' using errcode='22023'; end if;
  insert into public.payment_notices (group_id,contribution_id,submitted_by)
  values (p_group_id,contribution.id,auth.uid())
  on conflict (contribution_id,submitted_by) do update set status='pending', submitted_at=now(), resolved_at=null, resolved_by=null
  returning id into notice_id;
  return notice_id;
end; $$;

create or replace function public.confirm_contribution(p_contribution_id uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare contribution public.monthly_contributions%rowtype; event_id uuid;
begin
  select * into contribution from public.monthly_contributions where id=p_contribution_id for update;
  if not found or auth.uid() is null or not public.is_group_admin(contribution.group_id) then raise exception 'administrator access required' using errcode='42501'; end if;
  if contribution.paid_at is not null then raise exception 'payment already confirmed' using errcode='22023'; end if;
  insert into public.payment_events (group_id,contribution_id,event_type,amount_cents,actor_id) values (contribution.group_id,contribution.id,'confirmed',contribution.amount_cents,auth.uid()) returning id into event_id;
  update public.monthly_contributions set confirmed_amount_cents=amount_cents,paid_at=now(),confirmed_by=auth.uid(),updated_at=now() where id=contribution.id;
  update public.payment_notices set status='confirmed',resolved_at=now(),resolved_by=auth.uid()
    where contribution_id=contribution.id and status='pending';
  return event_id;
end; $$;

create or replace function public.resolve_payment_notice(p_notice_id uuid, p_resolution text)
returns void language plpgsql security definer set search_path = public
as $$
declare notice public.payment_notices%rowtype;
begin
  select * into notice from public.payment_notices where id=p_notice_id for update;
  if not found or auth.uid() is null or not public.is_group_admin(notice.group_id) then raise exception 'administrator access required' using errcode='42501'; end if;
  if notice.status<>'pending' then raise exception 'notice already resolved' using errcode='22023'; end if;
  if p_resolution='confirmed' then perform public.confirm_contribution(notice.contribution_id);
  elsif p_resolution<>'rejected' then raise exception 'invalid resolution' using errcode='22023'; end if;
  update public.payment_notices set status=p_resolution,resolved_at=now(),resolved_by=auth.uid() where id=notice.id;
end; $$;

grant execute on function public.update_contribution_amount(uuid,uuid,date,integer), public.ensure_contribution_period(uuid,date), public.submit_payment_notice(uuid,date), public.confirm_contribution(uuid), public.resolve_payment_notice(uuid,text) to authenticated;
