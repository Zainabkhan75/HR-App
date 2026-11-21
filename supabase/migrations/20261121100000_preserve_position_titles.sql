alter table public.position_records add column position_title text;

update public.position_records p
set position_title = d.title
from public.designations d
where d.id = p.designation_id;

create function hrms_private.seed_position_title()
returns trigger
language plpgsql
set search_path = ''
as $title$
begin
 if new.position_title is null then
  select d.title into strict new.position_title
  from public.designations d where d.id = new.designation_id;
 end if;
 return new;
end;
$title$;

create trigger seed_position_title
before insert on public.position_records
for each row execute function hrms_private.seed_position_title();

alter table public.position_records
 alter column position_title set not null,
 add constraint position_title_nonblank check (btrim(position_title) <> '');

create or replace view public.positions as
select p.id, d.department_id, p.position_title as title, p.location,
       p.reports_to_position_id, p.designation_id, p.position_code
from public.position_records p
left join public.designations d on d.id = p.designation_id;
