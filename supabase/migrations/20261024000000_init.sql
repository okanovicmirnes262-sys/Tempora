-- =====================================================================
-- Smjene — početna shema
-- Multi-tenant: svaki redak nosi org_id; RLS dopušta pristup samo
-- članovima organizacije. Radnici nemaju Supabase račun — pristupaju
-- isključivo preko w_* funkcija koje provjeravaju osobni token.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Tipovi
-- ---------------------------------------------------------------------
create type public.employment_type as enum ('puno', 'skraceno');
create type public.absence_type as enum ('godisnji', 'slobodan', 'bolovanje');
create type public.swap_status as enum ('ponudeno', 'prihvaceno', 'odobreno', 'odbijeno');
create type public.member_role as enum ('owner', 'manager');

-- ---------------------------------------------------------------------
-- Pomoćne funkcije
-- ---------------------------------------------------------------------
create or replace function public.new_token() returns text
language sql volatile set search_path = '' as $$
  -- 32 bajta = 256 bita nasumičnosti, base64url bez paddinga (43 znaka)
  select translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
$$;

create or replace function public.local_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Europe/Zagreb')::date;
$$;

-- ---------------------------------------------------------------------
-- Organizacije i članstvo
-- ---------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Moji kafići',
  country text not null default 'HR',
  timezone text not null default 'Europe/Zagreb',
  plan text not null default 'free',           -- spremno za naplatu
  invite_email text,                            -- seed: prvi login s ovim emailom postaje vlasnik
  created_at timestamptz not null default now()
);

create table public.members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index members_user_idx on public.members(user_id);

create or replace function public.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members m
    where m.org_id = p_org and m.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------
-- Lokali i predlošci smjena
-- ---------------------------------------------------------------------
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  closed_weekdays smallint[] not null default '{}',   -- ISO: 1 = pon … 7 = ned
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (id, org_id)
);
create index locations_org_idx on public.locations(org_id);

create table public.shift_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  location_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  start_time time not null,
  end_time time not null,          -- ako je end <= start, smjena završava sljedeći dan
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (location_id, org_id) references public.locations(id, org_id) on delete cascade
);
create index shift_templates_org_idx on public.shift_templates(org_id);

create table public.location_closures (
  org_id uuid not null,
  location_id uuid not null,
  date date not null,
  primary key (location_id, date),
  foreign key (location_id, org_id) references public.locations(id, org_id) on delete cascade
);
create index location_closures_org_idx on public.location_closures(org_id, date);

-- ---------------------------------------------------------------------
-- Radnici
-- ---------------------------------------------------------------------
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  phone text,
  token text not null unique default public.new_token(),
  employment_type public.employment_type not null default 'puno',
  weekly_hours numeric(4,1) not null default 40 check (weekly_hours >= 0 and weekly_hours <= 60),
  active boolean not null default true,
  sort_order int not null default 0,
  first_opened_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, org_id),
  check (length(token) >= 32)
);
create index employees_org_idx on public.employees(org_id);

-- ---------------------------------------------------------------------
-- Raspored: skica (assignments) i objavljeno (published_assignments)
-- Vlasnik uređuje skicu; "Objavi" kopira raspon u objavljeno.
-- Radnici vide samo objavljeno.
-- ---------------------------------------------------------------------
create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  date date not null,
  shift_template_id uuid not null,
  employee_id uuid not null,
  created_at timestamptz not null default now(),
  unique (date, shift_template_id, employee_id),
  foreign key (shift_template_id, org_id) references public.shift_templates(id, org_id) on delete cascade,
  foreign key (employee_id, org_id) references public.employees(id, org_id) on delete cascade
);
create index assignments_org_date_idx on public.assignments(org_id, date);
create index assignments_emp_date_idx on public.assignments(employee_id, date);

create table public.published_assignments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  date date not null,
  shift_template_id uuid not null,
  employee_id uuid not null,
  published_at timestamptz not null default now(),
  unique (date, shift_template_id, employee_id),
  foreign key (shift_template_id, org_id) references public.shift_templates(id, org_id) on delete cascade,
  foreign key (employee_id, org_id) references public.employees(id, org_id) on delete cascade
);
create index published_org_date_idx on public.published_assignments(org_id, date);
create index published_emp_date_idx on public.published_assignments(employee_id, date);

-- ---------------------------------------------------------------------
-- Odsutnosti, uzorci, dostupnost
-- ---------------------------------------------------------------------
create table public.absences (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  employee_id uuid not null,
  date_from date not null,
  date_to date not null,
  type public.absence_type not null,
  created_at timestamptz not null default now(),
  check (date_to >= date_from),
  foreign key (employee_id, org_id) references public.employees(id, org_id) on delete cascade
);
create index absences_org_idx on public.absences(org_id, date_from, date_to);

create table public.weekly_patterns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  employee_id uuid not null,
  weekday smallint not null check (weekday between 1 and 7),   -- ISO: 1 = pon
  shift_template_id uuid,          -- null + is_off = slobodan dan
  is_off boolean not null default false,
  check ((shift_template_id is null) = is_off),
  foreign key (employee_id, org_id) references public.employees(id, org_id) on delete cascade,
  foreign key (shift_template_id, org_id) references public.shift_templates(id, org_id) on delete cascade
);
create unique index weekly_patterns_uniq
  on public.weekly_patterns(employee_id, weekday, coalesce(shift_template_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index weekly_patterns_org_idx on public.weekly_patterns(org_id);

create table public.availability (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  employee_id uuid not null,
  date date,                        -- jednokratno: "ne mogu 17.10."
  weekday smallint check (weekday between 1 and 7),   -- stalno: "subotom ne"
  note text,
  created_at timestamptz not null default now(),
  check ((date is null) <> (weekday is null)),
  foreign key (employee_id, org_id) references public.employees(id, org_id) on delete cascade
);
create index availability_org_idx on public.availability(org_id);
create unique index availability_weekday_uniq on public.availability(employee_id, weekday) where weekday is not null;
create unique index availability_date_uniq on public.availability(employee_id, date) where date is not null;

-- ---------------------------------------------------------------------
-- Zamjene
-- ---------------------------------------------------------------------
create table public.swap_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  date date not null,
  shift_template_id uuid not null,
  from_employee_id uuid not null,
  to_employee_id uuid,              -- null = ponuđeno svima
  accepted_by uuid,
  status public.swap_status not null default 'ponudeno',
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  foreign key (shift_template_id, org_id) references public.shift_templates(id, org_id) on delete cascade,
  foreign key (from_employee_id, org_id) references public.employees(id, org_id) on delete cascade,
  foreign key (to_employee_id, org_id) references public.employees(id, org_id) on delete cascade,
  foreign key (accepted_by, org_id) references public.employees(id, org_id) on delete cascade
);
create index swap_requests_org_idx on public.swap_requests(org_id, status);
create unique index swap_requests_open_uniq
  on public.swap_requests(date, shift_template_id, from_employee_id)
  where status in ('ponudeno', 'prihvaceno');

-- ---------------------------------------------------------------------
-- Push pretplate (vlasnik: user_id, radnik: employee_id)
-- ---------------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  employee_id uuid,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  check ((user_id is null) <> (employee_id is null)),
  foreign key (employee_id, org_id) references public.employees(id, org_id) on delete cascade
);
create index push_subscriptions_org_idx on public.push_subscriptions(org_id);

-- ---------------------------------------------------------------------
-- Pravila rada kao podaci
-- ---------------------------------------------------------------------
create table public.labor_rules (
  id uuid primary key default gen_random_uuid(),
  country text not null,
  valid_from date not null,
  rules jsonb not null,
  created_at timestamptz not null default now(),
  unique (country, valid_from)
);

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.organizations enable row level security;
alter table public.members enable row level security;
alter table public.locations enable row level security;
alter table public.shift_templates enable row level security;
alter table public.location_closures enable row level security;
alter table public.employees enable row level security;
alter table public.assignments enable row level security;
alter table public.published_assignments enable row level security;
alter table public.absences enable row level security;
alter table public.weekly_patterns enable row level security;
alter table public.availability enable row level security;
alter table public.swap_requests enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.labor_rules enable row level security;

create policy org_select on public.organizations for select to authenticated
  using (public.is_org_member(id));
create policy org_update on public.organizations for update to authenticated
  using (public.is_org_member(id)) with check (public.is_org_member(id));

create policy members_select on public.members for select to authenticated
  using (user_id = auth.uid() or public.is_org_member(org_id));

-- Sve tablice s org_id: član organizacije smije sve, nitko drugi ništa.
do $$
declare t text;
begin
  foreach t in array array[
    'locations', 'shift_templates', 'location_closures', 'employees',
    'assignments', 'published_assignments', 'absences', 'weekly_patterns',
    'availability', 'swap_requests'
  ] loop
    execute format(
      'create policy %1$s_member_all on public.%1$s for all to authenticated
         using (public.is_org_member(org_id)) with check (public.is_org_member(org_id))', t);
  end loop;
end $$;

-- Vlasnik vidi i briše pretplate svoje organizacije, a dodaje samo svoje.
create policy push_select on public.push_subscriptions for select to authenticated
  using (public.is_org_member(org_id));
create policy push_insert on public.push_subscriptions for insert to authenticated
  with check (public.is_org_member(org_id) and user_id = auth.uid() and employee_id is null);
create policy push_delete on public.push_subscriptions for delete to authenticated
  using (public.is_org_member(org_id));

create policy labor_rules_read on public.labor_rules for select to anon, authenticated
  using (true);

-- anon (radnici) nema nikakvih politika na tablicama => nema izravnog pristupa.
revoke all on all tables in schema public from anon;
grant select on public.labor_rules to anon;

-- =====================================================================
-- Funkcije za vlasnika
-- =====================================================================

-- Stvara organizaciju i vlasnika (postavljanje, korak 0).
create or replace function public.create_organization(p_name text default 'Moji kafići')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  if auth.uid() is null then raise exception 'Nisi prijavljen'; end if;
  insert into public.organizations(name) values (coalesce(nullif(trim(p_name), ''), 'Moji kafići'))
    returning id into v_org;
  insert into public.members(org_id, user_id, role) values (v_org, auth.uid(), 'owner');
  return v_org;
end $$;

-- Pri prijavi: preuzmi organizacije koje čekaju ovaj email (testni podaci).
create or replace function public.claim_invited_orgs()
returns setof uuid language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null or v_email = '' then return; end if;
  return query
  with claimed as (
    update public.organizations o set invite_email = null
    where lower(o.invite_email) = v_email
    returning o.id
  ), ins as (
    insert into public.members(org_id, user_id, role)
    select c.id, auth.uid(), 'owner' from claimed c
    on conflict do nothing
    returning org_id
  )
  select org_id from ins;
end $$;

create or replace function public.regenerate_employee_token(p_employee uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare v_token text;
begin
  update public.employees set token = public.new_token()
  where id = p_employee
  returning token into v_token;
  if v_token is null then raise exception 'Radnik nije pronađen'; end if;
  -- stari uređaji više ne smiju primati obavijesti
  delete from public.push_subscriptions where employee_id = p_employee;
  return v_token;
end $$;

-- Objava: kopira skicu u objavljeno za raspon i vraća radnike kojima se raspored promijenio.
create or replace function public.publish_range(p_org uuid, p_from date, p_to date)
returns setof uuid language plpgsql security invoker set search_path = '' as $$
begin
  if not public.is_org_member(p_org) then raise exception 'Zabranjeno'; end if;
  return query
  with d as (
    select a.employee_id, a.date, a.shift_template_id from public.assignments a
    where a.org_id = p_org and a.date between p_from and p_to
  ), p as (
    select a.employee_id, a.date, a.shift_template_id from public.published_assignments a
    where a.org_id = p_org and a.date between p_from and p_to
  ), diff as (
    (select * from d except select * from p)
    union
    (select * from p except select * from d)
  )
  select distinct diff.employee_id from diff;

  delete from public.published_assignments
  where org_id = p_org and date between p_from and p_to;
  insert into public.published_assignments(org_id, date, shift_template_id, employee_id)
  select org_id, date, shift_template_id, employee_id from public.assignments
  where org_id = p_org and date between p_from and p_to;
end $$;

-- Odobrenje zamjene jednim tapom: ažurira skicu i objavljeno.
create or replace function public.decide_swap(p_swap uuid, p_approve boolean)
returns public.swap_requests language plpgsql security invoker set search_path = '' as $$
declare s public.swap_requests;
begin
  select * into s from public.swap_requests where id = p_swap for update;
  if s.id is null then raise exception 'Zamjena nije pronađena'; end if;
  if not p_approve then
    if s.status not in ('ponudeno', 'prihvaceno') then raise exception 'Zamjena je već riješena'; end if;
    update public.swap_requests set status = 'odbijeno', decided_at = now()
      where id = p_swap returning * into s;
    return s;
  end if;
  if s.status <> 'prihvaceno' or s.accepted_by is null then
    raise exception 'Zamjenu prvo mora prihvatiti kolega';
  end if;

  delete from public.assignments
    where org_id = s.org_id and date = s.date and shift_template_id = s.shift_template_id and employee_id = s.from_employee_id;
  insert into public.assignments(org_id, date, shift_template_id, employee_id)
    values (s.org_id, s.date, s.shift_template_id, s.accepted_by) on conflict do nothing;
  delete from public.published_assignments
    where org_id = s.org_id and date = s.date and shift_template_id = s.shift_template_id and employee_id = s.from_employee_id;
  insert into public.published_assignments(org_id, date, shift_template_id, employee_id)
    values (s.org_id, s.date, s.shift_template_id, s.accepted_by) on conflict do nothing;

  update public.swap_requests set status = 'odobreno', decided_at = now()
    where id = p_swap returning * into s;
  return s;
end $$;

-- =====================================================================
-- Funkcije za radnike (anon + osobni token)
-- =====================================================================

create or replace function public.w_employee(p_token text)
returns public.employees language plpgsql stable security definer set search_path = '' as $$
declare e public.employees;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'Neispravan link'; end if;
  select * into e from public.employees where token = p_token and active;
  if e.id is null then raise exception 'Neispravan link'; end if;
  return e;
end $$;
revoke execute on function public.w_employee(text) from public, anon, authenticated;

-- Sve što radnik vidi, u jednom pozivu.
create or replace function public.w_bundle(p_token text, p_from date, p_to date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.employees := public.w_employee(p_token);
  v_month_start date := date_trunc('month', public.local_today())::date;
  v jsonb;
begin
  if p_to - p_from > 62 then raise exception 'Prevelik raspon'; end if;
  if e.first_opened_at is null then
    update public.employees set first_opened_at = now() where id = e.id;
  end if;

  select jsonb_build_object(
    'me', jsonb_build_object(
      'id', e.id, 'name', e.name, 'weekly_hours', e.weekly_hours,
      'employment_type', e.employment_type, 'first_open', e.first_opened_at is null),
    'org', (select jsonb_build_object('name', o.name, 'country', o.country) from public.organizations o where o.id = e.org_id),
    'shifts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', p.date, 'shift_template_id', t.id, 'shift', t.name, 'location', l.name,
        'start', to_char(t.start_time, 'HH24:MI'), 'end', to_char(t.end_time, 'HH24:MI'),
        'coworkers', coalesce((
          select jsonb_agg(c.name order by c.name)
          from public.published_assignments p2 join public.employees c on c.id = p2.employee_id
          where p2.date = p.date and p2.shift_template_id = p.shift_template_id and p2.employee_id <> e.id
        ), '[]'::jsonb)
      ) order by p.date, t.start_time)
      from public.published_assignments p
      join public.shift_templates t on t.id = p.shift_template_id
      join public.locations l on l.id = t.location_id
      where p.employee_id = e.id and p.date between least(p_from, v_month_start) and p_to
    ), '[]'::jsonb),
    'absences', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'from', a.date_from, 'to', a.date_to, 'type', a.type) order by a.date_from)
      from public.absences a where a.employee_id = e.id and a.date_to >= p_from and a.date_from <= p_to
    ), '[]'::jsonb),
    'availability', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'date', a.date, 'weekday', a.weekday, 'note', a.note)
                       order by a.weekday nulls last, a.date)
      from public.availability a where a.employee_id = e.id and (a.date is null or a.date >= public.local_today())
    ), '[]'::jsonb),
    'colleagues', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.sort_order, c.name)
      from public.employees c where c.org_id = e.org_id and c.active and c.id <> e.id
    ), '[]'::jsonb),
    'swaps', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'date', s.date, 'status', s.status, 'shift_template_id', s.shift_template_id,
        'shift', t.name, 'location', l.name,
        'start', to_char(t.start_time, 'HH24:MI'), 'end', to_char(t.end_time, 'HH24:MI'),
        'from_name', f.name, 'to_name', te.name, 'accepted_name', ac.name,
        'mine', s.from_employee_id = e.id,
        'accepted_by_me', s.accepted_by = e.id,
        'can_accept', s.status = 'ponudeno' and s.from_employee_id <> e.id
                      and (s.to_employee_id is null or s.to_employee_id = e.id)
                      and not exists (select 1 from public.published_assignments x
                                      where x.employee_id = e.id and x.date = s.date and x.shift_template_id = s.shift_template_id)
      ) order by s.date)
      from public.swap_requests s
      join public.shift_templates t on t.id = s.shift_template_id
      join public.locations l on l.id = t.location_id
      join public.employees f on f.id = s.from_employee_id
      left join public.employees te on te.id = s.to_employee_id
      left join public.employees ac on ac.id = s.accepted_by
      where s.org_id = e.org_id and s.date >= public.local_today()
        and (s.from_employee_id = e.id or s.accepted_by = e.id
             or (s.status = 'ponudeno' and (s.to_employee_id is null or s.to_employee_id = e.id)))
    ), '[]'::jsonb)
  ) into v;
  return v;
end $$;

create or replace function public.w_add_unavailability(p_token text, p_date date, p_weekday smallint, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.employees := public.w_employee(p_token); v_id uuid;
begin
  if p_date is not null and p_date < public.local_today() then raise exception 'Datum je u prošlosti'; end if;
  insert into public.availability(org_id, employee_id, date, weekday, note)
    values (e.org_id, e.id, p_date, p_weekday, nullif(trim(coalesce(p_note, '')), ''))
    on conflict do nothing
    returning id into v_id;
  return v_id;
end $$;

create or replace function public.w_remove_unavailability(p_token text, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.employees := public.w_employee(p_token);
begin
  delete from public.availability where id = p_id and employee_id = e.id;
end $$;

create or replace function public.w_offer_swap(p_token text, p_date date, p_shift_template uuid, p_to_employee uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.employees := public.w_employee(p_token); v_id uuid;
begin
  if p_date < public.local_today() then raise exception 'Smjena je prošla'; end if;
  if not exists (select 1 from public.published_assignments
                 where employee_id = e.id and date = p_date and shift_template_id = p_shift_template) then
    raise exception 'To nije tvoja smjena';
  end if;
  if p_to_employee is not null and not exists (
    select 1 from public.employees where id = p_to_employee and org_id = e.org_id and active and id <> e.id) then
    raise exception 'Kolega nije pronađen';
  end if;
  insert into public.swap_requests(org_id, date, shift_template_id, from_employee_id, to_employee_id)
    values (e.org_id, p_date, p_shift_template, e.id, p_to_employee)
    returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'Ova smjena je već ponuđena';
end $$;

create or replace function public.w_cancel_swap(p_token text, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.employees := public.w_employee(p_token);
begin
  delete from public.swap_requests
  where id = p_id and from_employee_id = e.id and status in ('ponudeno', 'prihvaceno');
end $$;

create or replace function public.w_accept_swap(p_token text, p_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.employees := public.w_employee(p_token); s public.swap_requests;
begin
  select * into s from public.swap_requests where id = p_id and org_id = e.org_id for update;
  if s.id is null or s.status <> 'ponudeno' then raise exception 'Ponuda više nije dostupna'; end if;
  if s.from_employee_id = e.id then raise exception 'Ne možeš prihvatiti svoju ponudu'; end if;
  if s.to_employee_id is not null and s.to_employee_id <> e.id then raise exception 'Ponuda nije za tebe'; end if;
  if s.date < public.local_today() then raise exception 'Smjena je prošla'; end if;
  update public.swap_requests set status = 'prihvaceno', accepted_by = e.id where id = p_id;
  return s.org_id;
end $$;

create or replace function public.w_save_push(p_token text, p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.employees := public.w_employee(p_token);
begin
  insert into public.push_subscriptions(org_id, employee_id, endpoint, p256dh, auth)
    values (e.org_id, e.id, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set org_id = excluded.org_id, employee_id = excluded.employee_id, user_id = null,
        p256dh = excluded.p256dh, auth = excluded.auth;
end $$;

-- Radničke funkcije dostupne su anon ulozi; vlasničke samo prijavljenima.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.new_token() to authenticated;
grant execute on function public.local_today() to anon, authenticated;
grant execute on function public.create_organization(text) to authenticated;
grant execute on function public.claim_invited_orgs() to authenticated;
grant execute on function public.regenerate_employee_token(uuid) to authenticated;
grant execute on function public.publish_range(uuid, date, date) to authenticated;
grant execute on function public.decide_swap(uuid, boolean) to authenticated;
grant execute on function public.w_bundle(text, date, date) to anon, authenticated;
grant execute on function public.w_add_unavailability(text, date, smallint, text) to anon, authenticated;
grant execute on function public.w_remove_unavailability(text, uuid) to anon, authenticated;
grant execute on function public.w_offer_swap(text, date, uuid, uuid) to anon, authenticated;
grant execute on function public.w_cancel_swap(text, uuid) to anon, authenticated;
grant execute on function public.w_accept_swap(text, uuid) to anon, authenticated;
grant execute on function public.w_save_push(text, text, text, text) to anon, authenticated;
