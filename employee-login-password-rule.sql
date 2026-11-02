do $rule$ declare s text;begin
s:=pg_get_functiondef('public.prepare_employee_login(uuid,uuid,text)'::regprocedure);
s:=replace(s,$old$ first_name:=(regexp_split_to_array(btrim(e.full_name),'[[:space:]]+'))[1];
 if e.employee_no !~ '^[0-9]{6}$' or nullif(first_name,'') is null then raise exception 'A first name and six-digit employee ID are required';end if;$old$,$new$ cnic:=regexp_replace(coalesce(d.profile->>'cnic_passport',''),'[-[:space:]]','','g');
 if cnic !~ '^[0-9]{13}$' then raise exception 'Add a valid 13-digit CNIC before creating a login';end if;
 first_name:=(regexp_split_to_array(btrim(e.full_name),'[[:space:]]+'))[1];
 if length(first_name)+4<6 then raise exception 'First name is too short for the agreed password rule. HR decision required.';end if;$new$);
s:=replace(s,'first_name||right(e.employee_no,5)','first_name||right(cnic,4)');
if position('right(cnic,4)' in s)=0 or position('Add a valid 13-digit CNIC' in s)=0 then raise exception 'Original rule restoration incomplete';end if;execute s;end $rule$;
notify pgrst,'reload schema';