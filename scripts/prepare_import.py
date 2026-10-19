"""Run locally: python scripts/prepare_import.py 'path/to/workbook.xlsx' 'private_employees.csv'.
Do not commit the resulting employee CSV to a repository.
Requires artifact_tool. Review the CSV before importing.
"""
import csv,sys,re
from artifact_tool import Blob,SpreadsheetFile
if len(sys.argv)!=3: raise SystemExit('Usage: python scripts/prepare_import.py input.xlsx output.csv')
wb=SpreadsheetFile.import_xlsx(Blob.load(sys.argv[1])); sheet=wb.worksheets.get_item('Employee Master')
rows=sheet.get_range('A1:K500').values
headers=['employee_no','full_name','designation','department','reports_to_text','location','record_status','source_note']
seen=set(); count=0
with open(sys.argv[2],'w',newline='',encoding='utf-8-sig') as f:
 w=csv.writer(f);w.writerow(headers)
 for r in rows[1:]:
  eid=str(r[0] or '').strip()
  if not eid:continue
  if not re.fullmatch(r'BND-\d{3,}',eid):raise ValueError('Unrecognised employee number format')
  if eid in seen:raise ValueError('Duplicate employee number: '+eid)
  seen.add(eid)
  name=str(r[1] or '').strip()
  if not name:raise ValueError('Missing name for '+eid)
  x=[eid,name,r[2],r[3],r[4],r[5],r[10],r[6]]
  w.writerow(['' if v is None else str(v) for v in x]);count+=1
print(f'Prepared {count} employee rows; payroll and private identity columns deliberately excluded.')
