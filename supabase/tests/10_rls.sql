-- RLS i radničke funkcije. Svaka provjera baca grešku ako ne prođe.
\set ON_ERROR_STOP 1

insert into auth.users(id, email) values
  ('11111111-1111-4111-8111-111111111111', 'tvoj@email.com'),
  ('22222222-2222-4222-8222-222222222222', 'drugi@kafic.hr');

-- ---------------------------------------------------------------------
-- 1) Vlasnik preuzima testnu organizaciju pri prvoj prijavi
-- ---------------------------------------------------------------------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true),
       set_config('request.jwt.claim.email', 'TVOJ@email.com', true);
do $$ begin
  assert (select count(*) from public.claim_invited_orgs()) = 1, 'claim nije preuzeo org';
  assert (select count(*) from public.employees) = 6, 'vlasnik ne vidi 6 radnika';
  assert (select count(*) from public.locations) = 2, 'vlasnik ne vidi 2 lokala';
end $$;
commit;

-- ---------------------------------------------------------------------
-- 2) Drugi korisnik stvara svoj kafić i ne vidi tuđe podatke
-- ---------------------------------------------------------------------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true),
       set_config('request.jwt.claim.email', 'drugi@kafic.hr', true);
do $$
declare v_org uuid; v_loc uuid;
begin
  assert (select count(*) from public.claim_invited_orgs()) = 0, 'drugi ne smije preuzeti org';
  assert (select count(*) from public.employees) = 0, 'drugi vidi tuđe radnike';
  assert (select count(*) from public.organizations) = 0, 'drugi vidi tuđu organizaciju';
  v_org := public.create_organization('Drugi kafić');
  insert into public.locations(org_id, name) values (v_org, 'Kod mene') returning id into v_loc;
  insert into public.employees(org_id, name) values (v_org, 'Ivo');
  assert (select count(*) from public.employees) = 1, 'drugi ne vidi svog radnika';
  -- pokušaj upisa u tuđu organizaciju mora pasti
  begin
    insert into public.employees(org_id, name) values ('00000000-0000-4000-8000-000000000001', 'Uljez');
    raise exception 'upis u tuđu org je prošao';
  exception when insufficient_privilege then null;
  end;
  -- tuđi predložak smjene ne smije se vezati uz svoj lokal (composite FK)
  begin
    insert into public.assignments(org_id, date, shift_template_id, employee_id)
    select v_org, '2026-11-01', '00000000-0000-4000-8000-0000000000b1', e.id from public.employees e limit 1;
    raise exception 'veza na tuđi predložak je prošla';
  exception when foreign_key_violation then null;
  end;
  -- tuđi radnik se ne može ažurirati (0 redaka)
  update public.employees set name = 'X' where id = '00000000-0000-4000-8000-0000000000c1';
  assert not found, 'ažuriran tuđi radnik';
end $$;
commit;

-- ---------------------------------------------------------------------
-- 3) anon (radnik bez tokena) nema izravnog pristupa tablicama
-- ---------------------------------------------------------------------
begin;
set local role anon;
do $$ begin
  begin
    perform 1 from public.employees;
    raise exception 'anon čita employees';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.publish_range('00000000-0000-4000-8000-000000000001', '2026-10-01', '2026-10-31');
    raise exception 'anon smije objaviti';
  exception when insufficient_privilege then null;
  end;
  assert (select count(*) from public.labor_rules where country = 'HR') = 1, 'anon ne vidi pravila';
  begin
    perform public.w_bundle('kriviTokenkriviTokenkriviTokenkriviToken', '2026-10-12', '2026-10-25');
    raise exception 'krivi token prošao';
  exception when raise_exception then
    if sqlerrm <> 'Neispravan link' then raise; end if;
  end;
end $$;
commit;

-- ---------------------------------------------------------------------
-- 4) Radnik s tokenom vidi samo svoj raspored
-- ---------------------------------------------------------------------
select token as filip_token from public.employees where name = 'Filip' \gset
select token as luca_token from public.employees where name = 'Luca' \gset
begin;
set local role anon;
select set_config('t.filip', :'filip_token', true), set_config('t.luca', :'luca_token', true);
do $$
declare b jsonb := public.w_bundle(current_setting('t.filip'), '2026-10-12', '2026-10-25');
begin
  assert b->'me'->>'name' = 'Filip', 'krivo ime';
  -- Filip: sub+ned u oba tjedna (4) + 14.–21. (8), 17./18. se preklapaju => 10
  assert jsonb_array_length(b->'shifts') = 10, 'Filip ima ' || jsonb_array_length(b->'shifts') || ' smjena';
  assert not exists (select 1 from jsonb_array_elements(b->'colleagues') c where c->>'name' = 'Filip'), 'sebe u kolegama';
  assert jsonb_array_length(b->'colleagues') = 5, 'kolege';
  assert not (b::text like '%+38591%'), 'radnik vidi brojeve mobitela';
  assert not (b::text like '%' || current_setting('t.luca') || '%'), 'radnik vidi tuđi token';
end $$;
commit;

-- ---------------------------------------------------------------------
-- 5) Zamjena: Filip nudi 25.10. svima, Luca prihvaća, vlasnik odobrava
-- ---------------------------------------------------------------------
-- (datum je u prošlosti u odnosu na stvarni datum testa? koristimo budući datum)
insert into public.published_assignments(org_id, date, shift_template_id, employee_id)
values ('00000000-0000-4000-8000-000000000001', public.local_today() + 3,
        '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000c3');
insert into public.assignments(org_id, date, shift_template_id, employee_id)
values ('00000000-0000-4000-8000-000000000001', public.local_today() + 3,
        '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000c3');

begin;
set local role anon;
select set_config('t.filip', :'filip_token', true), set_config('t.luca', :'luca_token', true);
do $$
declare v_swap uuid; b jsonb;
begin
  begin
    perform public.w_offer_swap(current_setting('t.luca'), public.local_today() + 3, '00000000-0000-4000-8000-0000000000b1', null);
    raise exception 'Luca ponudio tuđu smjenu';
  exception when raise_exception then
    if sqlerrm <> 'To nije tvoja smjena' then raise; end if;
  end;
  v_swap := public.w_offer_swap(current_setting('t.filip'), public.local_today() + 3, '00000000-0000-4000-8000-0000000000b1', null);
  b := public.w_bundle(current_setting('t.luca'), public.local_today(), public.local_today() + 7);
  assert exists (select 1 from jsonb_array_elements(b->'swaps') s where (s->>'id')::uuid = v_swap and (s->>'can_accept')::boolean),
    'Luca ne vidi ponudu';
  perform public.w_accept_swap(current_setting('t.luca'), v_swap);
  perform set_config('t.swap', v_swap::text, true);
end $$;
select current_setting('t.swap') as swap_id \gset
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('t.swap', :'swap_id', true);
do $$
declare s public.swap_requests;
begin
  s := public.decide_swap(current_setting('t.swap')::uuid, true);
  assert s.status = 'odobreno', 'status nije odobreno';
  assert exists (select 1 from public.published_assignments where date = public.local_today() + 3
                 and employee_id = '00000000-0000-4000-8000-0000000000c2'), 'Luca nije u objavljenom';
  assert not exists (select 1 from public.published_assignments where date = public.local_today() + 3
                 and employee_id = '00000000-0000-4000-8000-0000000000c3'
                 and shift_template_id = '00000000-0000-4000-8000-0000000000b1'), 'Filip je još u objavljenom';
end $$;
commit;

-- drugi vlasnik ne smije odlučivati o tuđoj zamjeni
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select set_config('t.swap', :'swap_id', true);
do $$ begin
  begin
    perform public.decide_swap(current_setting('t.swap')::uuid, false);
    raise exception 'tuđi vlasnik odlučio';
  exception when raise_exception then
    if sqlerrm <> 'Zamjena nije pronađena' then raise; end if;
  end;
end $$;
commit;

-- ---------------------------------------------------------------------
-- 6) Objava vraća samo radnike kojima se raspored promijenio
-- ---------------------------------------------------------------------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
do $$
declare n int;
begin
  select count(*) into n from public.publish_range('00000000-0000-4000-8000-000000000001', '2026-10-12', '2026-10-25');
  assert n = 0, 'bez promjena, a objava vraća ' || n;
  delete from public.assignments where date = '2026-10-20' and employee_id = '00000000-0000-4000-8000-0000000000c3';
  insert into public.assignments(org_id, date, shift_template_id, employee_id) values
    ('00000000-0000-4000-8000-000000000001', '2026-10-20', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000c5');
  select count(*) into n from public.publish_range('00000000-0000-4000-8000-000000000001', '2026-10-12', '2026-10-25');
  assert n = 2, 'očekivana 2 promijenjena radnika, dobiveno ' || n;
  assert not exists (select 1 from public.published_assignments where date = '2026-10-20'
                     and employee_id = '00000000-0000-4000-8000-0000000000c3'), 'objava nije prepisala';
end $$;
rollback;

-- ---------------------------------------------------------------------
-- 7) Novi token poništava stari link
-- ---------------------------------------------------------------------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('t.filip', :'filip_token', true);
do $$
declare v text;
begin
  v := public.regenerate_employee_token('00000000-0000-4000-8000-0000000000c3');
  assert v <> current_setting('t.filip') and length(v) >= 43, 'token nije promijenjen';
end $$;
set local role anon;
do $$ begin
  begin
    perform public.w_bundle(current_setting('t.filip'), '2026-10-12', '2026-10-25');
    raise exception 'stari token još radi';
  exception when raise_exception then
    if sqlerrm <> 'Neispravan link' then raise; end if;
  end;
end $$;
rollback;
