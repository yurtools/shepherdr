"""Drive real policy/helper persistence with fake hc only; never run the proposed command."""
import importlib.util, json, os, sys, threading
from pathlib import Path
from unittest import mock
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'mods/tasks/bin'))
from herdr_task import approvals as A
from herdr_task import approval_advice as D

def fixture(folder):
 app=Path(folder)/'app'
 spec=importlib.util.spec_from_file_location('delivery_ui',ROOT/'mods/chat/approval-policy.py')
 ui=importlib.util.module_from_spec(spec);spec.loader.exec_module(ui)
 owner={'state':'live','pid':42,'argv':['claude'],'status':{'state':'idle'},'labels':{'herdr.role':'feature','herdr.feature':'fixture-feature','herdr.coordinator.space':'fixture-space'}}
 worker={'state':'live','pid':43,'argv':['claude'],'labels':{'herdr.role':'worker','herdr.task':'FIX-1','herdr.task.space':'fixture-space','herdr.owner':'fixture-owner','herdr.feature':'fixture-feature'}}
 entered=threading.Event();resume=threading.Event();errors=[]
 def meta(terminal):
  if threading.current_thread().name=='delivery-poll':entered.set();resume.wait(5)
  return owner if terminal=='fixture-owner' else worker
 def call(*args):return ui.main(ui.parser().parse_args(list(args)))
 with mock.patch.object(A,'app_home',return_value=app),mock.patch.object(A,'hc_get',side_effect=meta),mock.patch.object(A,'settings',return_value={'mode':'assistant','policy':A.DEFAULT_POLICY}),mock.patch.object(A.subprocess,'run',return_value=mock.Mock(returncode=0,stdout='{}')):
  path=app/'data/chat-asks/req/fixture-worker.1700000000.999999999.json'
  req={'session_id':'fixture-session','cwd':'/fixture/project','tool_name':'Bash','tool_input':{'command':'cp report.txt /tmp/shared-report.txt','description':'Copy a report outside the project'}}
  A.write(path,req);call('evaluate','--request',str(path),'--terminal','fixture-worker')
  ticket=A.read(A.store()/'pending'/path.name)
  def poll():
   try:A.evaluate(path,'fixture-worker')
   except Exception as e:errors.append(str(e))
  thread=threading.Thread(target=poll,name='delivery-poll');thread.start()
  if not entered.wait(5):raise AssertionError('poll did not enter reviewer lookup')
  rationale='This writes outside the project; the policy delegates only project-local work.'
  try:
   with mock.patch.dict(os.environ,{'HC_TERMINAL_ID':'fixture-owner'}):call('decide','--id',ticket['id'],'--token',ticket['token'],'--decision','ask','--reason',rationale)
  finally:resume.set();thread.join(5)
  if thread.is_alive() or errors:raise AssertionError(errors or 'poll did not finish')
  handback=A.read(path.with_suffix('.status'))
  call('advice','--request',str(path),'--terminal','fixture-worker','--hash',A.status_key(req))
  advice_pending=A.read(path.with_suffix('.advice'))
  advice=A.read(D.ticket_path(path.stem));review_before=(A.store()/'pending'/path.name).read_bytes()
  with mock.patch.dict(os.environ,{'HC_TERMINAL_ID':'fixture-owner'}):
   call('advice-input','--id',advice['id'],'--token',advice['token'])
   call('advise','--id',advice['id'],'--token',advice['token'],'--summary','Copies report.txt to /tmp/shared-report.txt. It may replace that file.',
        '--detail','Reads the project report and writes outside the project. No network or extra process is apparent beyond cp. The source contents and current destination are unknown; nothing has been run or approved.')
  assert not (path.parent.parent/'ans'/path.name).exists()
  assert review_before==(A.store()/'pending'/path.name).read_bytes()
  assert A.read(path.with_suffix('.status'))==handback
  return {'app':str(app),'path':str(path),'id':path.stem,'request':req,'requestHash':A.status_key(req),'rationale':rationale,'handback':handback,'advicePending':advice_pending,'advice':A.read(path.with_suffix('.advice')),'pending':True,'reviewUnchanged':True}

if __name__=='__main__':print(json.dumps(fixture(sys.argv[1])))
