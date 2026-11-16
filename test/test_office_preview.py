import home_guard  # noqa: F401
import importlib.machinery, importlib.util, tempfile, unittest, zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
loader=importlib.machinery.SourceFileLoader('office_preview',str(ROOT/'mods/workspace-document/bin/herdr-office'))
spec=importlib.util.spec_from_loader(loader.name,loader);office=importlib.util.module_from_spec(spec);loader.exec_module(office)
class OfficePreview(unittest.TestCase):
 def package(self, suffix, parts):
  folder=tempfile.TemporaryDirectory();self.addCleanup(folder.cleanup);p=Path(folder.name)/('sample'+suffix)
  with zipfile.ZipFile(p,'w') as z:
   for name,value in parts.items(): z.writestr(name,value)
  return str(p)
 def test_word_keeps_body_order_headings_lists_and_tables(self):
  path=self.package('.docx',{'word/document.xml':f'''<w:document xmlns:w="{office.W[1:-1]}"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Overview</w:t></w:r></w:p><w:p><w:pPr><w:numPr/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>First item</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Name</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>A &amp; B</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'''})
  out=office.preview(path);self.assertEqual(out['kind'],'docx');self.assertIn('# Overview',out['markdown']);self.assertIn('- **First item**',out['markdown']);self.assertIn('| A & B |',out['markdown']);self.assertLess(out['markdown'].index('Overview'),out['markdown'].index('Name'))
 def workbook(self, sheet, extra=None):
  return self.package('.xlsx',{'xl/workbook.xml':f'<workbook xmlns="{office.S[1:-1]}" xmlns:r="{office.R[1:-1]}"><sheets><sheet name="Main &amp; More" sheetId="1" r:id="r1"/><sheet name="Other" sheetId="2" r:id="r2"/></sheets></workbook>', 'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="/xl/worksheets/sheet2.xml"/></Relationships>','xl/worksheets/sheet1.xml':f'<worksheet xmlns="{office.S[1:-1]}"><sheetData>{sheet}</sheetData></worksheet>','xl/worksheets/sheet2.xml':f'<worksheet xmlns="{office.S[1:-1]}"><sheetData/></worksheet>',**(extra or {})})
 def test_excel_sheets_shared_inline_sparse_boolean_and_cached_formula(self):
  path=self.workbook('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>Inline</t></is></c></row><row r="3"><c r="A3" t="b"><v>1</v></c><c r="B3"><f>1+2</f><v>3</v></c><c r="C3"><f>2+3</f></c></row>',{'xl/sharedStrings.xml':f'<sst xmlns="{office.S[1:-1]}"><si><r><t>Shared </t></r><r><t>text</t></r></si></sst>'})
  out=office.preview(path);self.assertEqual([s['name'] for s in out['sheets']],['Main & More','Other']);rows=out['sheets'][0]['rows'];self.assertEqual(rows[0],['Shared text','','Inline']);self.assertEqual(rows[1],[]);self.assertEqual(rows[2],['TRUE','3','[formula: no cached value]']);self.assertEqual(out['sheets'][0]['formulas'],2)
 def test_excel_dates_and_preview_bounds(self):
  path=self.workbook('<row r="1"><c r="A1" s="1"><v>45292</v></c><c r="CW1"><v>99</v></c></row><row r="501"><c r="A501"><v>lost</v></c></row>',{'xl/styles.xml':f'<styleSheet xmlns="{office.S[1:-1]}"><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>'})
  sheet=office.preview(path)['sheets'][0];self.assertEqual(sheet['rows'][0][0],'2024-01-01');self.assertEqual(len(sheet['rows'][0]),1);self.assertTrue(sheet['limited'])
 def test_external_or_invalid_relationship_is_not_followed(self):
  path=self.workbook('')
  with zipfile.ZipFile(path,'a') as z: z.writestr('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="r1" Target="../../etc/passwd"/></Relationships>')
  with self.assertRaisesRegex(ValueError,'Invalid worksheet'): office.preview(path)
 def test_xml_entities_and_large_packages_are_rejected_without_extracting(self):
  path=self.package('.docx',{'word/document.xml':'<!DOCTYPE x [<!ENTITY e "bad">]><x>&e;</x>'})
  with self.assertRaisesRegex(ValueError,'type declarations'): office.preview(path)
  path=self.package('.docx',{'word/document.xml':'x'*1024})
  old=office.MAX_TOTAL
  try:
   office.MAX_TOTAL=100
   with self.assertRaisesRegex(ValueError,'limited'): office.preview(path)
  finally: office.MAX_TOTAL=old
 def test_legacy_binary_formats_have_actionable_message(self):
  with self.assertRaisesRegex(ValueError,'Save a copy as DOCX or XLSX'): office.preview('/not-read.xls')
if __name__=='__main__': unittest.main()
