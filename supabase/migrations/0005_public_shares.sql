revoke all on public.public_shares from anon, authenticated;
alter table public.public_shares alter column slug drop not null;
grant select on public.public_shares to authenticated;
create policy public_shares_admin_select on public.public_shares for select to authenticated
  using (public.is_group_admin(group_id));

create or replace function public.set_public_share(p_group_id uuid, p_enabled boolean, p_include_pix boolean default false)
returns text language plpgsql security definer set search_path = public
as $$
declare current_slug text;
begin
  if auth.uid() is null or not public.is_group_admin(p_group_id) then raise exception 'administrator access required' using errcode='42501'; end if;
  if p_enabled then
    insert into public.public_shares(group_id,slug,enabled,include_pix)
    values (p_group_id,substr(replace(gen_random_uuid()::text,'-',''),1,24),true,coalesce(p_include_pix,false))
    on conflict (group_id) do update set
      slug=case when public.public_shares.enabled then public.public_shares.slug else excluded.slug end,
      enabled=true,include_pix=excluded.include_pix,updated_at=now()
    returning slug into current_slug;
  else
    update public.public_shares set enabled=false,include_pix=false,slug=null,updated_at=now() where group_id=p_group_id;
    current_slug:=null;
  end if;
  return current_slug;
end; $$;

create or replace function public.get_public_group_summary(p_slug text)
returns table (
  slug text, group_name text, description text, due_day smallint, month_start date,
  expected_cents bigint, received_cents bigint, pending_cents bigint,
  paid_count bigint, total_count bigint, include_pix boolean, pix_key text
)
language sql stable security definer set search_path = public
as $$
  with selected as (
    select s.slug,g.id,g.name,g.description,g.due_day,s.include_pix,
      case when s.include_pix then g.pix_key else null end as pix_key,
      date_trunc('month',now() at time zone 'America/Sao_Paulo')::date as local_month
    from public.public_shares s join public.groups g on g.id=s.group_id
    where s.slug=p_slug and s.enabled and g.group_type='fee'
  ), totals as (
    select c.group_id,c.month_start,
      coalesce(sum(c.amount_cents),0)::bigint as expected_cents,
      coalesce(sum(case when c.paid_at is not null then c.confirmed_amount_cents else 0 end),0)::bigint as received_cents,
      coalesce(sum(case when c.paid_at is null then c.amount_cents else 0 end),0)::bigint as pending_cents,
      count(*) filter (where c.paid_at is not null)::bigint as paid_count,
      count(*)::bigint as total_count
    from public.monthly_contributions c join selected s on s.id=c.group_id and s.local_month=c.month_start
    group by c.group_id,c.month_start
  )
  select s.slug,s.name,s.description,s.due_day,s.local_month,
    coalesce(t.expected_cents,0),coalesce(t.received_cents,0),coalesce(t.pending_cents,0),
    coalesce(t.paid_count,0),coalesce(t.total_count,0),s.include_pix,s.pix_key
  from selected s left join totals t on t.group_id=s.id;
$$;

revoke all on function public.get_public_group_summary(text) from public, authenticated, anon;
revoke all on function public.set_public_share(uuid,boolean,boolean) from public, anon;
grant execute on function public.get_public_group_summary(text) to anon, authenticated;
grant execute on function public.set_public_share(uuid,boolean,boolean) to authenticated;

-- Send only the public slug as a Realtime hint; the client fetches the aggregate via the safe RPC.
-- The trigger is installed only on hosted Supabase, where realtime.send is provided by the Realtime extension.
do $$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    execute $function$
      create or replace function public.broadcast_public_summary_hint()
      returns trigger language plpgsql security definer set search_path = public
      as $body$
      declare target_group uuid; target_slug text;
      begin
        if tg_table_name='public_shares' then
          target_group:=coalesce(new.group_id,old.group_id);
          target_slug:=coalesce(old.slug,new.slug);
        elsif tg_table_name='groups' then
          target_group:=coalesce(new.id,old.id);
          select s.slug into target_slug from public.public_shares s where s.group_id=target_group and s.enabled;
        else
          target_group:=coalesce(new.group_id,old.group_id);
          select s.slug into target_slug from public.public_shares s where s.group_id=target_group and s.enabled;
        end if;
        if target_slug is not null then
          perform realtime.send(jsonb_build_object('slug',target_slug),'summary_updated','tapago-public:'||target_slug,false);
        end if;
        if tg_op='DELETE' then return old; end if;
        return new;
      end;
      $body$
    $function$;
    execute 'create trigger public_summary_group_update after update on public.groups for each row execute function public.broadcast_public_summary_hint()';
    execute 'create trigger public_summary_participant_change after insert or update or delete on public.group_participants for each row execute function public.broadcast_public_summary_hint()';
    execute 'create trigger public_summary_contribution_change after insert or update or delete on public.monthly_contributions for each row execute function public.broadcast_public_summary_hint()';
    execute 'create trigger public_summary_payment_event after insert on public.payment_events for each row execute function public.broadcast_public_summary_hint()';
    execute 'create trigger public_summary_share_change after insert or update or delete on public.public_shares for each row execute function public.broadcast_public_summary_hint()';
  end if;
end;
$$;
