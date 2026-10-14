alter table public.invitations alter column participant_id set not null;

create unique index invitations_one_open_participant
  on public.invitations (participant_id)
  where accepted_at is null and revoked_at is null;

create or replace function public.create_group_invitation(
  p_group_id uuid,
  p_participant_id uuid,
  p_invited_email text,
  p_token_hash text
)
returns table (id uuid, expires_at timestamptz)
language plpgsql security definer
set search_path = public
as $$
declare
  normalized_email text := lower(trim(p_invited_email));
  normalized_hash text := lower(trim(p_token_hash));
  participant_row public.group_participants%rowtype;
begin
  if auth.uid() is null or not public.is_group_admin(p_group_id) then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if normalized_hash !~ '^[0-9a-f]{64}$'
     or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invitation is invalid' using errcode = '22023';
  end if;

  select * into participant_row
  from public.group_participants p
  where p.id = p_participant_id and p.group_id = p_group_id and p.active
  for update;
  if not found or participant_row.linked_user_id is not null then
    raise exception 'participant is unavailable for invitation' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.invitations i
    where i.group_id = p_group_id and i.invited_email = normalized_email
      and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
  ) or exists (
    select 1 from auth.users u
    join public.group_memberships m on m.user_id = u.id and m.group_id = p_group_id and m.active
    where lower(u.email) = normalized_email
  ) then
    raise exception 'an active invitation or membership already exists' using errcode = '22023';
  end if;

  insert into public.invitations (group_id, participant_id, invited_email, token_hash, expires_at, created_by)
  values (p_group_id, p_participant_id, normalized_email, normalized_hash, now() + interval '7 days', auth.uid())
  returning invitations.id, invitations.expires_at into id, expires_at;
  return next;
end;
$$;

create or replace function public.accept_group_invitation(p_token_hash text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  normalized_hash text := lower(trim(p_token_hash));
  account_email text;
  account_confirmed_at timestamptz;
  invitation_row public.invitations%rowtype;
  participant_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if normalized_hash !~ '^[0-9a-f]{64}$' then raise exception 'invitation is invalid or unavailable' using errcode = '22023'; end if;

  select u.email, u.email_confirmed_at into account_email, account_confirmed_at
  from auth.users u where u.id = auth.uid();
  if account_email is null or account_confirmed_at is null then
    raise exception 'verified account email required' using errcode = '42501';
  end if;

  select * into invitation_row
  from public.invitations i
  where i.token_hash = normalized_hash
  for update;
  if not found or invitation_row.accepted_at is not null or invitation_row.revoked_at is not null
     or invitation_row.expires_at <= now()
     or invitation_row.invited_email <> lower(trim(account_email)) then
    raise exception 'invitation is invalid or unavailable' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.group_memberships m
    where m.group_id = invitation_row.group_id and m.user_id = auth.uid() and m.active
  ) then
    raise exception 'account already belongs to this group' using errcode = '22023';
  end if;

  update public.group_participants p set linked_user_id = auth.uid()
  where p.id = invitation_row.participant_id and p.group_id = invitation_row.group_id
    and p.active and p.linked_user_id is null;
  if not found then raise exception 'participant is unavailable for invitation' using errcode = '22023'; end if;

  insert into public.group_memberships (group_id, user_id, role, active)
  values (invitation_row.group_id, auth.uid(), 'participant', true)
  on conflict (group_id, user_id) do update set role = 'participant', active = true, joined_at = now();

  update public.invitations i set accepted_at = now(), accepted_by = auth.uid()
  where i.id = invitation_row.id;
  return invitation_row.participant_id;
end;
$$;

create or replace function public.revoke_group_invitation(p_invitation_id uuid)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  changed_count integer;
begin
  update public.invitations i set revoked_at = now()
  where i.id = p_invitation_id and i.accepted_at is null and i.revoked_at is null
    and public.is_group_admin(i.group_id);
  get diagnostics changed_count = row_count;
  if changed_count <> 1 then raise exception 'invitation is unavailable' using errcode = '22023'; end if;
  return true;
end;
$$;

create or replace function public.revoke_member_link(p_group_id uuid, p_participant_id uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  linked_user uuid;
begin
  if auth.uid() is null or not public.is_group_admin(p_group_id) then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  select p.linked_user_id into linked_user
  from public.group_participants p
  where p.id = p_participant_id and p.group_id = p_group_id
  for update;
  if not found or linked_user is null then raise exception 'participant is not linked' using errcode = '22023'; end if;

  update public.group_memberships m set active = false
  where m.group_id = p_group_id and m.user_id = linked_user;
  update public.group_participants p set linked_user_id = null
  where p.id = p_participant_id and p.group_id = p_group_id;
  return linked_user;
end;
$$;

grant execute on function public.create_group_invitation(uuid, uuid, text, text) to authenticated;
grant execute on function public.accept_group_invitation(text) to authenticated;
grant execute on function public.revoke_group_invitation(uuid) to authenticated;
grant execute on function public.revoke_member_link(uuid, uuid) to authenticated;
