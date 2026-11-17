import home_guard  # noqa: F401
import json, os, subprocess, sys, tempfile, unittest
from pathlib import Path
SCANNER=Path(__file__).resolve().parent.parent/'mods/chat/bin/herdr-skills'
class SkillPicker(unittest.TestCase):
 def test_selected_account_shared_project_disabled_and_plugin_skills(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);user=root/'user';account=root/'account';repo=root/'repo';(repo/'.git').mkdir(parents=True)
   def skill(where,name):
    where.mkdir(parents=True);(where/'SKILL.md').write_text(f'---\nname: {name}\ndescription: A skill\n---\n')
   skill(user/'.agents/skills/shared','shared');skill(account/'skills/account','account');skill(repo/'.agents/skills/project','project');skill(account/'skills/disabled','disabled');skill(account/'plugins/cache/market/plugin/1.0/skills/test','test')
   (account/'config.toml').write_text('[[skills.config]]\nname="disabled"\nenabled=false\n[plugins."plugin@market"]\nenabled=true\n')
   r=subprocess.run([sys.executable,str(SCANNER),str(repo),str(account)],env={**os.environ,'HOME':str(user)},text=True,capture_output=True,check=True)
   names={x['name'] for x in json.loads(r.stdout)};self.assertTrue({'shared','account','project','plugin:test'}<=names);self.assertNotIn('disabled',names)
if __name__=='__main__':unittest.main()
