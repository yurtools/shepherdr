import home_guard  # noqa: F401
import importlib.machinery, importlib.util, tempfile, unittest, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
loader=importlib.machinery.SourceFileLoader('project_files',str(ROOT/'mods/workspace-file-search/bin/herdr-project-files'));spec=importlib.util.spec_from_loader(loader.name,loader);mod=importlib.util.module_from_spec(spec);loader.exec_module(mod)
class ProjectFiles(unittest.TestCase):
 def test_non_git_project_is_bounded_and_does_not_traverse_dependency_or_symlink_directories(self):
  with tempfile.TemporaryDirectory() as d,tempfile.TemporaryDirectory() as outside:
   root=Path(d);(root/'src').mkdir();(root/'src/main.ts').write_text('const x=1');(root/'node_modules').mkdir();(root/'node_modules/no.js').write_text('');(Path(outside)/'secret').write_text('');(root/'linked').symlink_to(outside,target_is_directory=True)
   self.assertEqual(mod.files(d)['files'],['src/main.ts']);self.assertTrue(mod.files(d,1)['limited'])
 def test_git_files_include_untracked_but_respect_ignores(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);subprocess.run(['git','init','-q',d],check=True);(root/'.gitignore').write_text('ignored.txt\n');(root/'kept.ts').write_text('');(root/'ignored.txt').write_text('')
   names=mod.files(d)['files'];self.assertIn('kept.ts',names);self.assertNotIn('ignored.txt',names)
