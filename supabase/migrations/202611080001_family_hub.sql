-- Additive release migration. Run AFTER 202611070001_team.sql, once.
-- Parent Supabase identities remain unchanged. Child credentials are separate:
-- children never receive a parent JWT or access to the parent tables/Storage.
create table public.app_hub_state(household uuid primary key references app_households(id),version integer not null,data jsonb not null);
create unique index app_hub_child_username on app_hub_state((data->'child'->>'username')) where data->'child'->>'username' is not null;
create table public.app_hub_sessions(token text primary key,household uuid not null references app_households(id),child text not null,credential text not null,expires timestamptz not null);
create table public.app_hub_limits(key text primary key,started timestamptz not null,attempts integer not null);
create table public.app_hub_awards(record uuid not null references app_records(id),day date not null,household uuid not null references app_households(id),title text not null,active boolean not null,at timestamptz not null,primary key(record,day));
alter table app_hub_state enable row level security;
alter table app_hub_sessions enable row level security;
alter table app_hub_limits enable row level security;
alter table app_hub_awards enable row level security;
revoke all on app_hub_state,app_hub_sessions,app_hub_limits,app_hub_awards from anon,authenticated;

create function public.app_hub_chore_award() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare r app_records;
begin
 select * into r from app_records where id=new.record;
 if (r.kind='routines' and r.data->>'type'='chore') or exists(select 1 from app_hub_awards where record=new.record and day=new.day) then
  insert into app_hub_awards values(new.record,new.day,r.household,r.data->>'title',new.checked,new.at)
  on conflict(record,day) do update set active=excluded.active,at=excluded.at;
 end if;
 return new;
end $$;
create trigger hub_chore_award after insert or update on app_checks for each row execute function app_hub_chore_award();
insert into app_hub_awards select c.record,c.day,r.household,r.data->>'title',c.checked,c.at from app_checks c join app_records r on r.id=c.record where r.kind='routines' and r.data->>'type'='chore' on conflict do nothing;

create function public.app_hub_parent() returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare u uuid:=app_actor(); result jsonb;
begin
 select jsonb_build_object('id',id,'household',household,'name',name,'role','parent') into result from app_profiles where id=u;
 if result is null then raise exception using errcode='28000',message='Finish setting up your team first.';end if;
 return result;
end $$;

-- Only the application server can use this store. It first verifies the parent
-- with app_hub_parent(), or a hashed child session with the session operation.
create function public.app_hub_service(p_action text,p_body jsonb) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare h uuid; s app_hub_state; child jsonb; result jsonb; n integer; credential text;
begin
 if p_action in ('read','store','createSession','chores') then h:=(p_body->>'household')::uuid;end if;
 if p_action='chores' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'title',r.data->>'title','type',r.data->>'type','checked',coalesce(c.checked,false)) order by r.data->>'time',r.created_at)
   from app_records r join app_households hrow on hrow.id=r.household
   left join app_checks c on c.record=r.id and c.day=(now() at time zone hrow.timezone)::date
   where r.household=h and r.kind='routines' and not r.archived and r.data->'days' @> to_jsonb(array[extract(dow from now() at time zone hrow.timezone)::integer])), '[]'::jsonb);
 end if;
 if p_action='read' then
  select * into s from app_hub_state where household=h;
  return jsonb_build_object('data',s.data,'version',coalesce(s.version,0),
   'awards',coalesce((select jsonb_agg(to_jsonb(a)-'household' order by a.at desc) from app_hub_awards a where a.household=h),'[]'::jsonb),
   'members',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name) from app_profiles where household=h),'[]'::jsonb),
   'childName',(select child_name from app_households where id=h));
 elsif p_action='store' then
  perform 1 from app_households where id=h for update;
  select * into s from app_hub_state where household=h for update;
  if coalesce(s.version,0)<>(p_body->>'version')::integer or (select count(*) from app_hub_awards where household=h and active)<>(p_body->>'earned')::integer then return 'false'::jsonb;end if;
  insert into app_hub_state values(h,(p_body->>'version')::integer+1,p_body->'data') on conflict(household) do update set version=excluded.version,data=excluded.data;
  if p_body->>'profileName' is not null then update app_profiles set name=p_body->>'profileName' where id=(p_body->>'actor')::uuid and household=h;end if;
  return 'true'::jsonb;
 elsif p_action='childLookup' then
  select jsonb_build_object('household',household,'child',data->'child') into result from app_hub_state where data->'child'->>'username'=p_body->>'username';return result;
 elsif p_action='limit' then
  delete from app_hub_limits where started<now()-interval '15 minutes';
  insert into app_hub_limits values(p_body->>'key',now(),1) on conflict(key) do update set attempts=app_hub_limits.attempts+1 returning attempts into n;
  return to_jsonb(n<=10);
 elsif p_action='createSession' then
  select data->'child' into child from app_hub_state where household=h;
  if not coalesce((child->>'enabled')::boolean,false) or child->>'id' is distinct from p_body->>'child' or child->>'credentialVersion' is distinct from p_body->>'credential' then return 'false'::jsonb;end if;
  delete from app_hub_sessions where expires<now();
  insert into app_hub_sessions values(p_body->>'token',h,p_body->>'child',p_body->>'credential',now()+interval '7 days');return 'true'::jsonb;
 elsif p_action='session' then
  select jsonb_build_object('id',session_row.child,'household',session_row.household,'name',household_row.child_name,'role','child') into result
  from app_hub_sessions session_row join app_hub_state state_row on state_row.household=session_row.household join app_households household_row on household_row.id=session_row.household
  where session_row.token=p_body->>'token' and session_row.expires>now() and state_row.data->'child'->>'id'=session_row.child and state_row.data->'child'->>'credentialVersion'=session_row.credential and (state_row.data->'child'->>'enabled')::boolean;
  return result;
 elsif p_action='deleteSession' then delete from app_hub_sessions where token=p_body->>'token';return 'true'::jsonb;
 else raise exception using errcode='22023',message='Unknown household operation.';
 end if;
end $$;
revoke all on function app_hub_parent(),app_hub_service(text,jsonb),app_hub_chore_award() from public,anon,authenticated;
grant execute on function app_hub_parent() to authenticated;
grant execute on function app_hub_service(text,jsonb) to service_role;
notify pgrst,'reload schema';
