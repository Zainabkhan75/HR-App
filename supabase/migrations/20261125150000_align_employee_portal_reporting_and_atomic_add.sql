-- Keep employee organisation details sourced from the same position hierarchy as HR.
CREATE OR REPLACE FUNCTION public.my_employee_organisation()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'department_code',org.id,
    'department',org.name,
    'subdepartment_code',dep.department_code,
    'subdepartment',dep.name,
    'position_code',seat.position_code,
    'position_title',seat.position_title,
    'designation_code',ds.designation_code,
    'designation',ds.title,
    'location',seat.location,
    'reports_to_position_code',parent.position_code,
    'reports_to_position_title',parent.position_title,
    'reports_to_employee_name',CASE
      WHEN seat.is_reporting_root THEN 'Top position'
      WHEN parent.id IS NULL THEN NULL
      ELSE COALESCE((
        SELECT string_agg(manager.full_name, ', ' ORDER BY manager.full_name)
        FROM public.employee_records manager
        WHERE manager.position_id=parent.id AND manager.employment_state='active'
      ),'Vacant')
    END,
    'reports_to_status',CASE
      WHEN seat.id IS NULL THEN NULL
      WHEN seat.is_reporting_root THEN 'top_position'
      WHEN parent.id IS NULL THEN 'unassigned'
      WHEN EXISTS (
        SELECT 1 FROM public.employee_records manager
        WHERE manager.position_id=parent.id AND manager.employment_state='active'
      ) THEN 'occupied'
      ELSE 'vacant'
    END,
    'effective_manager_position_code',contact.position_code,
    'effective_manager_position_title',contact.position_title,
    'effective_manager_name',contact.manager_name,
    'reporting_fallback_used',parent.id IS NOT NULL AND contact.position_id IS NOT NULL AND contact.position_id<>parent.id
  )
  FROM public.employee_accounts account
  JOIN public.employee_records employee ON employee.id=account.employee_id
  LEFT JOIN public.position_records seat ON seat.id=employee.position_id
  LEFT JOIN public.departments dep ON dep.id=seat.department_id
  LEFT JOIN public.organisation_departments org ON org.id=dep.parent_department_id
  LEFT JOIN public.designations ds ON ds.id=seat.designation_id
  LEFT JOIN public.position_records parent ON parent.id=seat.reports_to_position_id
  LEFT JOIN LATERAL (
    WITH RECURSIVE chain(position_id,position_code,position_title,reports_to_position_id,depth,visited) AS (
      SELECT parent.id,parent.position_code,parent.position_title,parent.reports_to_position_id,1,ARRAY[parent.id]::bigint[]
      WHERE parent.id IS NOT NULL
      UNION ALL
      SELECT next.id,next.position_code,next.position_title,next.reports_to_position_id,chain.depth+1,chain.visited||next.id
      FROM chain
      JOIN public.position_records next ON next.id=chain.reports_to_position_id
      WHERE NOT next.id=ANY(chain.visited)
    )
    SELECT chain.position_id,chain.position_code,chain.position_title,
      string_agg(manager.full_name, ', ' ORDER BY manager.full_name) AS manager_name
    FROM chain
    JOIN public.employee_records manager ON manager.position_id=chain.position_id AND manager.employment_state='active'
    GROUP BY chain.position_id,chain.position_code,chain.position_title,chain.depth
    ORDER BY chain.depth
    LIMIT 1
  ) contact ON true
  WHERE account.user_id=auth.uid()
    AND account.is_active
    AND NOT account.must_change_password
    AND employee.employment_state<>'inactive'
$function$;

REVOKE ALL ON FUNCTION public.my_employee_organisation() FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.my_employee_organisation() TO authenticated;

-- Create the employee and assign the position in the same INSERT. Creating first
-- through create_employee() now fails because the employee view rejects active
-- records without a position before a follow-up UPDATE can run.
CREATE OR REPLACE FUNCTION public.create_employee_at_position(
  p_full_name text,
  p_position_id bigint,
  p_location text DEFAULT NULL,
  p_source_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  employee_number text;
  employee_id uuid;
BEGIN
  IF NOT coalesce(public.is_hr_admin(),false) THEN
    RAISE EXCEPTION 'HR administrator access required' USING errcode='42501';
  END IF;
  IF nullif(btrim(p_full_name),'') IS NULL THEN
    RAISE EXCEPTION 'Employee name is required' USING errcode='22023';
  END IF;
  IF p_position_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.position_records WHERE id=p_position_id
  ) THEN
    RAISE EXCEPTION 'Select an existing position.' USING errcode='22023';
  END IF;

  employee_number := nextval('public.employee_number_sequence')::text;
  INSERT INTO public.employees(employee_no,full_name,position_id,location,source_note)
  VALUES(employee_number,btrim(p_full_name),p_position_id,nullif(btrim(p_location),''),nullif(btrim(p_source_note),''))
  RETURNING id INTO employee_id;
  RETURN employee_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_employee_at_position(text,bigint,text,text) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_employee_at_position(text,bigint,text,text) TO authenticated;

