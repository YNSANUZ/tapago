create index if not exists expense_templates_active_group on public.expense_templates(group_id) where active;
create index if not exists expense_occurrences_history on public.expense_occurrences(expense_id,month_start desc);

revoke insert, update, delete on public.expense_occurrences from authenticated;
grant select on public.expense_occurrences to authenticated;

create or replace function public.ensure_current_expense_occurrences(p_group_id uuid)
returns setof public.expense_occurrences
language plpgsql security definer set search_path = public
as $$
declare
  local_today date := (now() at time zone 'America/Sao_Paulo')::date;
  local_month date := date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;
begin
  if auth.uid() is null or not public.is_group_admin(p_group_id) then raise exception 'administrator access required' using errcode='42501'; end if;
  if not exists (select 1 from public.groups where id=p_group_id and group_type in ('personal','household','other')) then raise exception 'recurring expenses require an expense list' using errcode='22023'; end if;
  insert into public.expense_occurrences(expense_id,month_start,due_date,amount_cents,status)
  select e.id,local_month,
    make_date(extract(year from local_month)::int,extract(month from local_month)::int,
      least(e.due_day,extract(day from (date_trunc('month',local_month)+interval '1 month - 1 day'))::int)),
    e.amount_cents,'pending'
  from public.expense_templates e
  where e.group_id=p_group_id and e.active
  on conflict(expense_id,month_start) do nothing;
  return query select o.* from public.expense_occurrences o join public.expense_templates e on e.id=o.expense_id
    where e.group_id=p_group_id and o.month_start=local_month order by o.due_date,o.id;
end; $$;

create or replace function public.confirm_expense_occurrence(p_occurrence_id uuid)
returns uuid language plpgsql security definer set search_path = public
as $$
declare occurrence public.expense_occurrences%rowtype; group_id uuid;
begin
  select e.group_id into group_id from public.expense_occurrences o join public.expense_templates e on e.id=o.expense_id where o.id=p_occurrence_id;
  if group_id is null or auth.uid() is null or not public.is_group_admin(group_id) then raise exception 'administrator access required' using errcode='42501'; end if;
  select * into occurrence from public.expense_occurrences where id=p_occurrence_id for update;
  if occurrence.status<>'pending' then raise exception 'occurrence already confirmed' using errcode='22023'; end if;
  update public.expense_occurrences set status='paid',paid_at=now(),confirmed_by=auth.uid() where id=p_occurrence_id;
  return p_occurrence_id;
end; $$;

grant execute on function public.ensure_current_expense_occurrences(uuid), public.confirm_expense_occurrence(uuid) to authenticated;
