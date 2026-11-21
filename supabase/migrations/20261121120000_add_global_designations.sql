alter table public.designations alter column department_id drop not null;
create unique index designations_global_title_idx on public.designations (lower(title)) where department_id is null;
insert into public.designations (id,title) overriding system value values
 (201,'CEO'),(202,'Section Lead'),(203,'Team Lead'),(204,'Partner'),(205,'Specialist'),
 (206,'Executive'),(207,'Associate'),(208,'Officers'),(209,'Support');
do $sequence$
begin
 if (select last_value from public.designations_id_seq) <= 209 then
  alter sequence public.designations_id_seq restart with 210;
 end if;
end;
$sequence$;