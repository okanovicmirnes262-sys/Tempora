-- =====================================================================
-- Testni podaci: Barone + Arsen, 6 radnika, raspored 12.–25.10.2026.
--
-- PRIJE POKRETANJA: zamijeni 'tvoj@email.com' svojim emailom.
-- Kad se prvi put prijaviš tim emailom, postaješ vlasnik ove organizacije.
-- =====================================================================

insert into public.organizations (id, name, invite_email)
values ('00000000-0000-4000-8000-000000000001', 'Barone & Arsen', 'tvoj@email.com');

insert into public.locations (id, org_id, name, sort_order) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', 'Barone', 1),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000001', 'Arsen', 2);

insert into public.shift_templates (id, org_id, location_id, name, start_time, end_time, sort_order) values
  ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'Dnevna',  '09:00', '17:00', 1),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a2', 'Jutro',   '09:00', '15:00', 1),
  ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a2', 'Popodne', '15:00', '21:00', 2);

insert into public.employees (id, org_id, name, phone, employment_type, weekly_hours, sort_order) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000001', 'Kristina', '+385910000001', 'puno', 40, 1),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-000000000001', 'Luca',     '+385910000002', 'puno', 40, 2),
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-000000000001', 'Filip',    '+385910000003', 'puno', 40, 3),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-000000000001', 'Bruno',    '+385910000004', 'puno', 40, 4),
  ('00000000-0000-4000-8000-0000000000c5', '00000000-0000-4000-8000-000000000001', 'Franko',   '+385910000005', 'puno', 40, 5),
  ('00000000-0000-4000-8000-0000000000c6', '00000000-0000-4000-8000-000000000001', 'Mirnes',   '+385910000006', 'puno', 40, 6);

-- Stalni tjedni uzorci (1 = pon … 7 = ned).
--          Barone      Arsen jutro   Arsen popodne
-- pon      Kristina    Franko        Luca
-- uto      Kristina    Franko        Luca
-- sri      Kristina    Mirnes        Bruno
-- čet      Kristina    Mirnes        Bruno
-- pet      Kristina    Mirnes        Luca
-- sub      Filip       Franko        Bruno
-- ned      Filip       Franko        Bruno
with p(emp, wd, tpl) as (values
  ('c1', 1, 'b1'), ('c1', 2, 'b1'), ('c1', 3, 'b1'), ('c1', 4, 'b1'), ('c1', 5, 'b1'),
  ('c3', 6, 'b1'), ('c3', 7, 'b1'),
  ('c5', 1, 'b2'), ('c5', 2, 'b2'), ('c5', 6, 'b2'), ('c5', 7, 'b2'),
  ('c6', 3, 'b2'), ('c6', 4, 'b2'), ('c6', 5, 'b2'),
  ('c2', 1, 'b3'), ('c2', 2, 'b3'), ('c2', 5, 'b3'),
  ('c4', 3, 'b3'), ('c4', 4, 'b3'), ('c4', 6, 'b3'), ('c4', 7, 'b3')
)
insert into public.weekly_patterns (org_id, employee_id, weekday, shift_template_id, is_off)
select '00000000-0000-4000-8000-000000000001',
       ('00000000-0000-4000-8000-0000000000' || emp)::uuid, wd,
       ('00000000-0000-4000-8000-0000000000' || tpl)::uuid, false
from p;

-- Dani bez smjene u uzorku = slobodan dan.
insert into public.weekly_patterns (org_id, employee_id, weekday, shift_template_id, is_off)
select e.org_id, e.id, wd, null, true
from public.employees e cross join generate_series(1, 7) wd
where e.org_id = '00000000-0000-4000-8000-000000000001'
  and not exists (select 1 from public.weekly_patterns w where w.employee_id = e.id and w.weekday = wd);

-- Raspored 12.–25.10. iz uzoraka.
insert into public.assignments (org_id, date, shift_template_id, employee_id)
select w.org_id, d::date, w.shift_template_id, w.employee_id
from public.weekly_patterns w
cross join generate_series('2026-10-12'::date, '2026-10-25'::date, interval '1 day') d
where w.org_id = '00000000-0000-4000-8000-000000000001'
  and not w.is_off
  and extract(isodow from d) = w.weekday;

-- TEST 1: Filip radi svaki dan 14.–21.10. (Barone) => crveno upozorenje za tjedni odmor.
insert into public.assignments (org_id, date, shift_template_id, employee_id)
select '00000000-0000-4000-8000-000000000001', d::date,
       '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000c3'
from generate_series('2026-10-14'::date, '2026-10-21'::date, interval '1 day') d
on conflict do nothing;

-- TEST 2: Luca Arsen popodne 22.10. pa Arsen jutro 23.10. => žuto (točno 12 h odmora).
insert into public.assignments (org_id, date, shift_template_id, employee_id) values
  ('00000000-0000-4000-8000-000000000001', '2026-10-22', '00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000c2'),
  ('00000000-0000-4000-8000-000000000001', '2026-10-23', '00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000c2')
on conflict do nothing;

-- Slobodni dani prema uzorku (tamo gdje radnik taj dan ne radi).
insert into public.absences (org_id, employee_id, date_from, date_to, type)
select w.org_id, w.employee_id, d::date, d::date, 'slobodan'
from public.weekly_patterns w
cross join generate_series('2026-10-12'::date, '2026-10-25'::date, interval '1 day') d
where w.org_id = '00000000-0000-4000-8000-000000000001'
  and w.is_off
  and extract(isodow from d) = w.weekday
  and not exists (select 1 from public.assignments a where a.employee_id = w.employee_id and a.date = d::date);

-- Godišnji: Mirnes 26.–30.10.
insert into public.absences (org_id, employee_id, date_from, date_to, type) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c6', '2026-10-26', '2026-10-30', 'godisnji');

-- Dostupnost: Bruno ne može subotom.
insert into public.availability (org_id, employee_id, weekday, note) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c4', 6, 'Subotom ne mogu');

-- Objavi ta dva tjedna.
insert into public.published_assignments (org_id, date, shift_template_id, employee_id)
select org_id, date, shift_template_id, employee_id from public.assignments
where org_id = '00000000-0000-4000-8000-000000000001';
