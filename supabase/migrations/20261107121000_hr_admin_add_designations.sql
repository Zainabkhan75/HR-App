grant insert on public.approved_designations to authenticated;
create policy "HR administrators add designations"
  on public.approved_designations for insert to authenticated
  with check ((select public.is_hr_admin()) and char_length(title) <= 120
    and lower(title) not in ('assitant manager','sale advisor','sales adviser','sale executive','sales man',
      'manager merchandiser','admin manager','hod it/erp','hr head','human resources','store manager'));

CREATE OR REPLACE FUNCTION hrms_private.require_approved_designation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare proposed text; canonical text; previous text;
begin
  if tg_table_name='employees' then
    proposed:=new.designation;
    if tg_op='UPDATE' then previous:=old.designation; end if;
  else
    proposed:=new.profile->>'previous_designation';
    if tg_op='UPDATE' then previous:=old.profile->>'previous_designation'; end if;
  end if;
  if proposed is not distinct from previous or nullif(btrim(proposed),'') is null then return new; end if;
  select title into canonical from public.approved_designations where lower(title)=lower(btrim(proposed));
  if not found then
    raise exception 'Choose an approved designation. Ask HR to add a missing designation.' using errcode='22023';
  end if;
  if tg_table_name='employees' then new.designation:=canonical;
  else new.profile:=jsonb_set(new.profile,'{previous_designation}',to_jsonb(canonical)); end if;
  return new;
end;
$function$;
