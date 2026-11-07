-- Apply to a dedicated Supabase project. No SQLite data is modified or imported.
create table public.app_households (
  id uuid primary key default gen_random_uuid(), child_name text not null,
  team_version integer not null default 1, named_by uuid, named_at timestamptz,
  timezone text not null default 'America/Chicago', timezone_version integer not null default 0
);
create table public.app_profiles (
  id uuid primary key references auth.users(id), household uuid not null references public.app_households(id),
  name text not null, created_at timestamptz not null default now()
);
create index app_profiles_household on public.app_profiles(household);
create table public.app_records (
  id uuid primary key default gen_random_uuid(), household uuid not null references public.app_households(id),
  kind text not null check(kind in ('papers','pickups','homework','gifts','routines','info')),
  data jsonb not null, archived boolean not null default false, version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index app_records_household on public.app_records(household,kind);
create table public.app_events (
  id bigint generated always as identity primary key, record uuid not null references public.app_records(id),
  household uuid not null references public.app_households(id), actor uuid not null references public.app_profiles(id),
  action text not null, note text not null default '', snapshot jsonb not null, at timestamptz not null default now()
);
create index app_events_record on public.app_events(record,id);
create table public.app_requests (
  actor uuid not null references public.app_profiles(id), key text not null, operation text not null,
  target uuid not null, body jsonb not null, primary key(actor,key)
);
create table public.app_checks (
  record uuid not null references public.app_records(id), day date not null, checked boolean not null,
  version integer not null default 1, actor uuid not null references public.app_profiles(id),
  at timestamptz not null default now(), primary key(record,day)
);
create table public.app_invites (
  token_hash text primary key, household uuid not null references public.app_households(id),
  created_by uuid not null references public.app_profiles(id), expires timestamptz not null,
  used_by uuid references public.app_profiles(id)
);
create table public.app_uploads (
  id uuid primary key default gen_random_uuid(), household uuid not null references public.app_households(id),
  actor uuid not null references public.app_profiles(id), path text not null unique, original text not null,
  mime text not null, size integer not null check(size>0 and size<=10485760),
  validated boolean not null default false, expires timestamptz not null default now()+interval '1 hour'
);

-- Session existence makes a signed-out JWT fail database and Storage checks too.
create function public.app_actor() returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); s text := auth.jwt()->>'session_id';
begin
  if u is null or s is null or not exists(select 1 from auth.sessions where id::text=s and user_id=u) then
    raise exception using errcode='28000', message='Please sign in.';
  end if;
  return u;
end $$;
create function public.app_household() returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select household from app_profiles where id=app_actor()
$$;
create function public.app_member(h uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(h=app_household(),false)
$$;
create function public.app_name(v text, lim integer) returns text language plpgsql immutable set search_path = public, pg_temp as $$
begin
  v:=regexp_replace(btrim(v),' +',' ','g');
  if v is null or length(v)=0 or length(v)>lim or v ~ '[[:cntrl:]]' then
    raise exception using errcode='22023', message='Enter a name within the character limit.';
  end if;
  return v;
end $$;
create function public.app_text(d jsonb,k text,lim integer,required boolean default false) returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare v text;
begin
  if d ? k and jsonb_typeof(d->k) is distinct from 'string' then
    raise exception using errcode='22023',message='Enter text for this field.';
  end if;
  v:=btrim(coalesce(d->>k,''));
  if length(v)>lim or (required and v='') then
    raise exception using errcode='22023',message='Enter the required details within the character limits.';
  end if;
  return v;
end $$;
create function public.app_date(v text) returns text language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if v is null or v !~ '^\d{4}-\d{2}-\d{2}$' or to_char(v::date,'YYYY-MM-DD')<>v then
    raise exception using errcode='22023',message='Choose a valid date.';
  end if;
  return v;
end $$;
create function public.app_context() returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('day',to_char(now() at time zone timezone,'YYYY-MM-DD'),
    'weekday',extract(dow from now() at time zone timezone)::integer,
    'timezone',timezone,'timezoneVersion',timezone_version) from app_households where id=app_household()
$$;
create function public.app_team() returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('childName',h.child_name,'name','Team '||h.child_name,'version',h.team_version,
    'updatedBy',p.name,'updatedAt',h.named_at) from app_households h left join app_profiles p on p.id=h.named_by where h.id=app_household()
$$;
create function public.app_me() returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u uuid:=app_actor(); p app_profiles; members jsonb;
begin
  select * into p from app_profiles where id=u;
  if not found then return jsonb_build_object('onboardingRequired',true,'user',jsonb_build_object('id',u),'members','[]'::jsonb); end if;
  select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name) into members from app_profiles where household=p.household;
  return jsonb_build_object('user',jsonb_build_object('id',u,'name',p.name),'members',members,'team',app_team(),'uploads','direct');
end $$;
create function public.app_invite_available(p_code text) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from app_invites i where token_hash=encode(sha256(convert_to(p_code,'UTF8')),'hex') and expires>now() and used_by is null
    and (select count(*) from app_profiles where household=i.household)<2)
$$;
create function public.app_onboard(p_body jsonb) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid:=app_actor(); h uuid; c text; invite app_invites; n text:=app_name(p_body->>'name',80);
begin
  if exists(select 1 from app_profiles where id=u) then return app_me(); end if;
  if p_body->>'mode'='create' then
    c:=app_name(p_body->>'childName',40);
    insert into app_households(child_name,named_by,named_at) values(c,u,now()) returning id into h;
  elsif p_body->>'mode'='join' then
    select * into invite from app_invites where token_hash=encode(sha256(convert_to(btrim(p_body->>'invite'),'UTF8')),'hex');
    if not found then raise exception using errcode='P0409',message='This invitation is unavailable. Ask for a new code.'; end if;
    h:=invite.household;
    perform 1 from app_households where id=h for update;
    select * into invite from app_invites where token_hash=invite.token_hash for update;
    if invite.used_by is not null or invite.expires<=now() or (select count(*) from app_profiles where household=h)>=2 then
      raise exception using errcode='P0409',message='This invitation is expired, used, or unavailable. Ask for a new code.';
    end if;
  else raise exception using errcode='22023',message='Choose whether to create or join a team.';
  end if;
  insert into app_profiles(id,household,name) values(u,h,n);
  if p_body->>'mode'='join' then update app_invites set used_by=u where token_hash=invite.token_hash; end if;
  return app_me();
end $$;
create function public.app_invitation() returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid:=app_actor(); h uuid:=app_household(); code text:=replace(gen_random_uuid()::text,'-',''); until timestamptz:=now()+interval '72 hours';
begin
  if h is null then raise exception using errcode='28000',message='Finish setting up your team first.'; end if;
  perform 1 from app_households where id=h for update;
  if (select count(*) from app_profiles where household=h)>=2 then raise exception using errcode='P0409',message='Both parent places on this team are filled.'; end if;
  delete from app_invites where household=h and used_by is null;
  insert into app_invites values(encode(sha256(convert_to(code,'UTF8')),'hex'),h,u,until,null);
  return jsonb_build_object('code',code,'expires',extract(epoch from until)*1000);
end $$;
create function public.app_record_json(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r app_records; result jsonb; ctx jsonb:=app_context(); ck jsonb;
begin
  select * into r from app_records where id=p_id and household=app_household();
  if not found then raise exception using errcode='P0404',message='Record not found.'; end if;
  result:=jsonb_build_object('id',r.id,'version',r.version,'created_at',r.created_at,'updated_at',r.updated_at);
  if r.kind in ('gifts','routines','info') then
    result:=result||jsonb_build_object('kind',r.kind,'data',r.data,'archived',r.archived);
    if r.kind='routines' then
      select jsonb_build_object('day',c.day,'checked',c.checked,'version',c.version,'actor',p.name,'at',c.at) into ck from app_checks c join app_profiles p on c.actor=p.id where c.record=r.id and c.day=(ctx->>'day')::date;
      result:=result||jsonb_build_object('scheduledToday',r.data->'days' @> jsonb_build_array((ctx->>'weekday')::integer),
        'check',coalesce(ck,jsonb_build_object('day',ctx->>'day','checked',false,'version',0,'actor',null,'at',null)));
    end if;
  else
    result:=result||r.data;
    if r.kind='papers' then result:=result||jsonb_build_object('created',r.created_at); end if;
  end if;
  return result;
end $$;
create function public.app_read(p_kind text,p_id uuid default null) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare h uuid:=app_household(); items jsonb; events jsonb; checks jsonb; received bigint; spent bigint;
begin
  if h is null then raise exception using errcode='28000',message='Finish setting up your team first.'; end if;
  if p_kind not in ('papers','pickups','homework','gifts','routines','info') then raise exception using errcode='P0404',message='Not found.'; end if;
  if p_id is not null then
    if not exists(select 1 from app_records where id=p_id and household=h and kind=p_kind) then raise exception using errcode='P0404',message='Record not found.'; end if;
    items:=app_record_json(p_id);
    select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'note',e.note,'snapshot',e.snapshot,'at',e.at,'actor',p.name) order by e.id),'[]'::jsonb) into events from app_events e join app_profiles p on p.id=e.actor where e.record=p_id and e.household=h;
    if p_kind in ('gifts','routines','info') then
      select coalesce(jsonb_agg(jsonb_build_object('day',c.day,'checked',c.checked,'version',c.version,'actor',p.name,'at',c.at) order by c.day desc),'[]'::jsonb) into checks from (select * from app_checks where record=p_id order by day desc limit 30)c join app_profiles p on p.id=c.actor;
      return jsonb_build_object('record',items,'events',events,'context',app_context(),'checks',checks);
    end if;
    return items||jsonb_build_object('events',events);
  end if;
  select coalesce(jsonb_agg(app_record_json(id) order by coalesce(data->>'due',data->>'scheduled_at',created_at::text),created_at,id),'[]'::jsonb) into items from app_records where household=h and kind=p_kind;
  if p_kind not in ('gifts','routines','info') then return items; end if;
  if p_kind='gifts' then
    select coalesce(sum((data->>'amountCents')::bigint) filter(where data->>'type'='money_in'),0),coalesce(sum((data->>'amountCents')::bigint) filter(where data->>'type'='money_out'),0) into received,spent from app_records where household=h and kind='gifts' and not archived;
    return jsonb_build_object('records',items,'context',app_context(),'totals',jsonb_build_object('receivedCents',received,'spentCents',spent,'balanceCents',received-spent));
  end if;
  return jsonb_build_object('records',items,'context',app_context());
end $$;
create function public.app_validate(p_kind text,d jsonb,h uuid) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare result jsonb:=jsonb_build_object('title',app_text(d,'title',160,true)); assignee app_profiles; amount bigint; days jsonb;
begin
  if jsonb_typeof(d) is distinct from 'object' then raise exception using errcode='22023',message='Enter the record details.'; end if;
  if p_kind in ('papers','homework') then result:=result||jsonb_build_object('due',app_date(d->>'due')); end if;
  if p_kind in ('papers','pickups') then
    select * into assignee from app_profiles where id::text=d->>'assignee' and household=h;
    if not found then raise exception using errcode='22023',message='Choose a parent in your household.'; end if;
    result:=result||jsonb_build_object('assignee',assignee.id,'assignee_name',assignee.name);
  end if;
  if p_kind in ('pickups','homework','gifts','routines') then result:=result||jsonb_build_object('note',app_text(d,'note',500)); end if;
  if p_kind='pickups' then
    if d->>'scheduled_at' is null or to_char((d->>'scheduled_at')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>d->>'scheduled_at' then raise exception using errcode='22023',message='Choose a valid pickup date and time.'; end if;
    result:=result||jsonb_build_object('scheduled_at',d->>'scheduled_at','location',app_text(d,'location',200,true));
  elsif p_kind='gifts' then
    if coalesce(d->>'type','') not in ('gift','money_in','money_out') or jsonb_typeof(d->'thankYou') is distinct from 'boolean' then raise exception using errcode='22023',message='Choose a gift or money type and thank-you status.'; end if;
    if d->'amountCents' is distinct from 'null'::jsonb then
      if jsonb_typeof(d->'amountCents') is distinct from 'number' or (d->>'amountCents') !~ '^\d+$' then raise exception using errcode='22023',message='Enter a USD amount with at most two decimal places.'; end if;
      amount:=(d->>'amountCents')::bigint;
      if amount>100000000 then raise exception using errcode='22023',message='Enter an amount up to $1,000,000.'; end if;
    end if;
    if d->>'type'<>'gift' and coalesce(amount,0)<=0 then raise exception using errcode='22023',message='Money received or spent needs an amount greater than zero.'; end if;
    result:=result||jsonb_build_object('type',d->>'type','date',app_date(d->>'date'),'from',app_text(d,'from',120),'occasion',app_text(d,'occasion',120),'amountCents',amount,'thankYou',case when d->>'type'='money_out' then false else (d->>'thankYou')::boolean end);
  elsif p_kind='routines' then
    days:=d->'days';
    if coalesce(d->>'type','') not in ('routine','chore') or jsonb_typeof(days) is distinct from 'array' then raise exception using errcode='22023',message='Choose a routine or chore and weekdays.'; end if;
    if jsonb_array_length(days)<1 or jsonb_array_length(days)>7 or exists(select 1 from jsonb_array_elements(days) v where jsonb_typeof(v)<>'number' or v::text !~ '^[0-6]$') or (select count(distinct v) from jsonb_array_elements(days)v)<>jsonb_array_length(days) then raise exception using errcode='22023',message='Choose at least one weekday; use each valid weekday once.'; end if;
    if coalesce(d->>'time','')<>'' and d->>'time' !~ '^([01]\d|2[0-3]):[0-5]\d$' then raise exception using errcode='22023',message='Choose a valid time or leave it blank.'; end if;
    if d->>'home' is distinct from 'both' and not exists(select 1 from app_profiles where household=h and id::text=d->>'home') then raise exception using errcode='22023',message='Choose both homes or a parent in your household.'; end if;
    result:=result||jsonb_build_object('type',d->>'type','days',days,'time',coalesce(d->>'time',''),'home',d->>'home');
  elsif p_kind='info' then
    if coalesce(d->>'category','') not in ('health','personal','emergency','school','other') or jsonb_typeof(d->'important') is distinct from 'boolean' then raise exception using errcode='22023',message='Choose a category and importance.'; end if;
    result:=result||jsonb_build_object('category',d->>'category','details',app_text(d,'details',4000,true),'important',d->'important');
  end if;
  return result;
end $$;
create function public.app_mutate(p_kind text,p_id uuid,p_body jsonb) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid:=app_actor(); h uuid:=app_household(); r app_records; prev app_requests; result uuid;
  action text; event text; d jsonb; snapshot jsonb; ctx jsonb; ck app_checks; upload app_uploads;
begin
  if h is null then raise exception using errcode='28000',message='Finish setting up your team first.'; end if;
  perform 1 from app_households where id=h for update;
  if p_kind not in ('papers','pickups','homework','gifts','routines','info') then raise exception using errcode='P0404',message='Not found.'; end if;
  if p_id is not null then
    select * into r from app_records where id=p_id and kind=p_kind and household=h for update;
    if not found then raise exception using errcode='P0404',message='Record not found.'; end if;
  end if;
  if p_kind='papers' and p_id is not null then
    action:=p_body->>'status';
    if action not in ('signed','returned') or action is null then raise exception using errcode='22023',message='Choose Signed or Returned.'; end if;
    if r.data->>'status'=action then return p_id; end if;
    if r.data->>'status'='returned' or (action='returned' and r.data->>'status'<>'signed') then raise exception using errcode='P0409',message='Review the current status. Sign the paper before returning it; Returned is final.'; end if;
    d:=r.data||jsonb_build_object('status',action,'note',app_text(p_body,'note',500)); event:=action;
  else
    if jsonb_typeof(p_body->'key') is distinct from 'string' or length(p_body->>'key') not between 1 and 100 then raise exception using errcode='22023',message='Reopen the form and try again.'; end if;
    select * into prev from app_requests where actor=u and key=p_body->>'key';
    if found then
      if prev.operation<>p_kind or (p_id is not null and prev.target<>p_id) or prev.body<>p_body then raise exception using errcode='P0409',message='This save was already used. Reopen the form.'; end if;
      return prev.target;
    end if;
    action:=case when p_id is null then 'created' else p_body->>'action' end;
    if p_id is not null and (jsonb_typeof(p_body->'version') is distinct from 'number' or (p_body->>'version')::numeric<>r.version) then raise exception using errcode='P0409',message='This record changed. Your draft is kept; review the latest details.'; end if;
    if p_kind in ('gifts','routines','info') then
      if action not in ('created','edit','archive','restore','check') or action is null or (action='check' and p_kind<>'routines') then raise exception using errcode='22023',message='Choose a valid record action.'; end if;
      if p_id is not null and ((r.archived and action<>'restore') or (not r.archived and action='restore')) then raise exception using errcode='P0409',message='Restore archived records before editing; active records are already restored.'; end if;
      d:=case when action in ('created','edit') then app_validate(p_kind,p_body->'data',h) else r.data end;
      event:=case action when 'created' then 'created' when 'edit' then 'edited' when 'archive' then 'archived' when 'restore' then 'restored' else 'checked' end;
    elsif p_kind='pickups' then
      if action not in ('created','edit','complete','cancel') or action is null then raise exception using errcode='22023',message='Choose a valid pickup action.'; end if;
      if p_id is not null and r.data->>'status'<>'scheduled' then raise exception using errcode='P0409',message='This pickup is final and cannot be edited.'; end if;
      d:=case when action in ('created','edit') then app_validate(p_kind,p_body,h)||jsonb_build_object('status','scheduled') else r.data||jsonb_build_object('status',case action when 'complete' then 'completed' else 'cancelled' end) end;
      event:=case action when 'created' then 'created' when 'edit' then 'edited' when 'complete' then 'completed' else 'cancelled' end;
    elsif p_kind='homework' then
      if action not in ('created','edit','note','start','done') or action is null then raise exception using errcode='22023',message='Choose a valid homework action.'; end if;
      if p_id is not null and (r.data->>'status'='done' or (action='start' and r.data->>'status'<>'not_started') or (action='done' and r.data->>'status'<>'in_progress')) then raise exception using errcode='P0409',message='Review the latest homework progress. Done is final.'; end if;
      d:=case when action in ('created','edit') then app_validate(p_kind,p_body,h)||jsonb_build_object('status',case when p_id is null then 'not_started' else r.data->>'status' end) else r.data||jsonb_build_object('note',app_text(p_body,'note',500),'status',case action when 'start' then 'in_progress' when 'done' then 'done' else r.data->>'status' end) end;
      event:=case action when 'created' then 'created' when 'edit' then 'edited' when 'note' then 'noted' when 'start' then 'started' else 'done' end;
    else
      d:=app_validate(p_kind,p_body,h); event:='added';
      select * into upload from app_uploads where id::text=p_body->>'uploadId' and actor=u and household=h and validated;
      if not found then raise exception using errcode='22023',message='Choose and upload a supported file before saving. Your fields are kept.'; end if;
      d:=d||jsonb_build_object('status','added','note','','file',upload.path,'mime',upload.mime,'original',upload.original,'creator',u);
    end if;
  end if;
  if p_id is null then
    insert into app_records(household,kind,data) values(h,p_kind,d) returning id into result;
  else
    result:=p_id;
    if action<>'check' then update app_records set data=d,archived=case action when 'archive' then true when 'restore' then false else archived end,version=version+1,updated_at=now() where id=p_id; end if;
  end if;
  if action='check' then
    ctx:=app_context();
    select * into ck from app_checks where record=p_id and day=(ctx->>'day')::date;
    if jsonb_typeof(p_body->'checked') is distinct from 'boolean' or (p_body->>'day') is distinct from (ctx->>'day') or coalesce((p_body->>'timezoneVersion')::numeric,-1)<>(ctx->>'timezoneVersion')::integer or not (r.data->'days' @> jsonb_build_array((ctx->>'weekday')::integer)) or coalesce((p_body->>'dayVersion')::numeric,-1)<>coalesce(ck.version,0) then raise exception using errcode='P0409',message='The day, schedule, or checkoff changed. Review the latest checklist.'; end if;
    insert into app_checks(record,day,checked,actor) values(p_id,(ctx->>'day')::date,(p_body->>'checked')::boolean,u) on conflict(record,day) do update set checked=excluded.checked,actor=u,version=app_checks.version+1,at=now();
    event:=case when (p_body->>'checked')::boolean then 'checked' else 'unchecked' end;
  end if;
  snapshot:=app_record_json(result);
  if action='check' then snapshot:=snapshot||jsonb_build_object('day',ctx->>'day','checked',p_body->'checked','timezone',ctx->>'timezone'); end if;
  insert into app_events(record,household,actor,action,note,snapshot) values(result,h,u,event,case when p_kind='papers' then coalesce(d->>'note','') else '' end,snapshot);
  if not(p_kind='papers' and p_id is not null) then insert into app_requests values(u,p_body->>'key',p_kind,result,p_body); end if;
  return result;
end $$;
create function public.app_settings(p_kind text,p_body jsonb) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid:=app_actor(); h uuid:=app_household(); v app_households; prev app_requests; value text;
begin
  select * into v from app_households where id=h for update;
  if not found then raise exception using errcode='28000',message='Finish setting up your team first.'; end if;
  if p_kind not in ('team','timezone') or p_kind is null then raise exception using errcode='P0404',message='Not found.'; end if;
  if jsonb_typeof(p_body->'key') is distinct from 'string' or length(p_body->>'key') not between 1 and 100 then raise exception using errcode='22023',message='Reopen settings and try again.'; end if;
  select * into prev from app_requests where actor=u and key=p_body->>'key';
  if found then
    if prev.operation<>p_kind or prev.body<>p_body then raise exception using errcode='P0409',message='This save was already used. Reopen settings.'; end if;
    return case p_kind when 'team' then app_team() else app_context() end;
  end if;
  if jsonb_typeof(p_body->'version') is distinct from 'number' or (p_body->>'version')::numeric<>(case p_kind when 'team' then v.team_version else v.timezone_version end) then raise exception using errcode='P0409',message='This setting changed. Your draft is kept; load the current setting.'; end if;
  if p_kind='team' then
    value:=app_name(p_body->>'childName',40);
    update app_households set child_name=value,team_version=team_version+1,named_by=u,named_at=now() where id=h;
  else
    value:=p_body->>'timezone';
    if value is null or not exists(select 1 from pg_timezone_names where name=value) then raise exception using errcode='22023',message='Choose an IANA time zone, such as America/Chicago.'; end if;
    update app_households set timezone=value,timezone_version=timezone_version+1 where id=h;
  end if;
  insert into app_requests values(u,p_body->>'key',p_kind,h,p_body);
  return case p_kind when 'team' then app_team() else app_context() end;
end $$;

create function public.app_new_upload(p_body jsonb) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid:=app_actor(); h uuid:=app_household(); upload app_uploads; ident uuid:=gen_random_uuid(); size numeric;
begin
  if h is null then raise exception using errcode='28000',message='Finish setting up your team first.'; end if;
  size:=(p_body->>'size')::numeric;
  if jsonb_typeof(p_body->'size') is distinct from 'number' or size<1 or size>10485760 or size<>trunc(size) or coalesce(p_body->>'mime','') not in ('application/pdf','image/jpeg','image/png') then raise exception using errcode='22023',message='Choose a JPEG, PNG or PDF up to 10 MB. Your other fields are kept.'; end if;
  insert into app_uploads(id,household,actor,path,original,mime,size) values(ident,h,u,'pending/'||h||'/'||u||'/'||ident,app_text(p_body,'name',200,true),p_body->>'mime',size) returning * into upload;
  return to_jsonb(upload);
end $$;
create function public.app_get_upload(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare result jsonb;
begin
  select to_jsonb(u) into result from app_uploads u where id=p_id and actor=app_actor() and household=app_household() and (expires>now() or validated);
  if result is null then raise exception using errcode='P0404',message='Upload not found or expired. Choose the file again; your fields are kept.'; end if;
  return result;
end $$;
-- Only the server's Supabase secret key can attest that original bytes were checked.
create function public.app_validate_upload(p_id uuid,p_path text) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists(select 1 from app_uploads where id=p_id and p_path=household||'/'||id) then raise exception using errcode='22023',message='Invalid attachment path.'; end if;
  update app_uploads set validated=true,path=p_path where id=p_id;
end $$;

alter table app_households enable row level security;
alter table app_profiles enable row level security;
alter table app_records enable row level security;
alter table app_events enable row level security;
alter table app_checks enable row level security;
alter table app_requests enable row level security;
alter table app_invites enable row level security;
alter table app_uploads enable row level security;
create policy member_read on app_households for select to authenticated using(app_member(id));
create policy member_read on app_profiles for select to authenticated using(app_member(household));
create policy member_read on app_records for select to authenticated using(app_member(household));
create policy member_read on app_events for select to authenticated using(app_member(household));
create policy member_read on app_checks for select to authenticated using(exists(select 1 from app_records r where r.id=record and app_member(r.household)));
revoke all on app_households,app_profiles,app_records,app_events,app_checks,app_requests,app_invites,app_uploads from anon,authenticated;
grant select on app_households,app_profiles,app_records,app_events,app_checks to authenticated;
-- Internal helpers are not public RPC endpoints. Only this migration's functions are affected.
do $$ declare f record; begin
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and left(proname,4)='app_' loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  end loop;
end $$;
grant execute on function app_me(),app_member(uuid),app_read(text,uuid),app_mutate(text,uuid,jsonb),app_settings(text,jsonb),app_onboard(jsonb),app_invitation(),app_new_upload(jsonb),app_get_upload(uuid) to authenticated;
grant execute on function app_invite_available(text) to anon,authenticated;
grant execute on function app_validate_upload(uuid,text) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('school-papers','school-papers',false,10485760,array['application/pdf','image/jpeg','image/png'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy school_paper_download on storage.objects for select to authenticated using(
  bucket_id='school-papers' and exists(select 1 from app_records r where r.kind='papers' and r.data->>'file'=name and app_member(r.household))
);
-- No authenticated INSERT/UPDATE/DELETE Storage policies: uploads require a
-- short-lived server-authorized upload token; originals are server-validated.
notify pgrst, 'reload schema';
