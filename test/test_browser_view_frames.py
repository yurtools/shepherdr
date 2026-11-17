"""Run the actual viewer functions with a fake terminal/CDP; never start a browser."""
import home_guard  # noqa: F401
import pathlib
import subprocess
import unittest

VIEW = pathlib.Path(__file__).resolve().parents[1] / "bin/herdr-browser-view"
HARNESS = r"""
const vm=require('vm'),fs=require('fs'),assert=require('assert/strict');
let output='',launched=[];
const record={profile:'default',space:'one',url:'https://chatgpt.com/',id:'page'};
const sandbox={require:n=>n==='fs'?{readFileSync:p=>{if(p.endsWith('workspace-browsers.json'))return JSON.stringify({page:record});throw Error('absent');},existsSync:()=>false}:n==='child_process'?{execFile:(cmd,args,opts,cb)=>{launched.push({cmd,args});cb(null,'','');return {stdin:{end(){}}};}}:require(n),
 process:{argv:['node','viewer','--page','page'],env:{HOME:'/unused'},platform:'linux',on(){},stdin:{on(){}},stdout:{columns:120,rows:30,write:s=>{output+=s;return true;}},stderr:{write(){}}},
 setTimeout,clearTimeout,Date,Promise,Buffer,WebSocket:class {constructor(){this.readyState=1;}close(){} }};
let src=fs.readFileSync(process.argv[1],'utf8').split('// ---- beats ----')[0];
vm.createContext(sandbox);vm.runInContext(src+'\nglobalThis.api={S,cdp,drawFrame,layoutPicture,bar,paint,openSystemBrowser:typeof openSystemBrowser===\"function\"?openSystemBrowser:null};',sandbox);
const {S,cdp,drawFrame,layoutPicture,bar,paint,openSystemBrowser}=sandbox.api;
S.cellW=10;S.cellH=20;S.page={w:1200,h:580};S.state='live';
const pause=()=>new Promise(r=>setImmediate(r));
const calls=[];cdp.call=async(method,params,session)=>{calls.push({method,params,session});return {}};
"""


class BrowserViewFrames(unittest.TestCase):
    def run_js(self, code):
        p = subprocess.run(["node", "-e", HARNESS + "\n(async()=>{" + code + "})().catch(e=>{console.error(e);process.exitCode=1});", str(VIEW)], capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)

    def test_previous_frame_survives_upload_and_storage_stays_bounded(self):
        self.run_js(r"""
layoutPicture(false);output='';
for(let i=0;i<4;i++)drawFrame('QUJD',()=>{});
const commands=[...output.matchAll(/\x1b_G([^;\x1b]*)(?:;[^\x1b]*)?\x1b\\/g)].map(m=>Object.fromEntries(m[1].split(',').map(x=>x.split('='))));
const live=new Set();let frames=0;
for(const c of commands){
 if(c.a==='t'||c.a==='T'){
  assert(!live.has(c.i),'must not replace an image still on screen during upload');
  if(frames)assert(live.size>0,'last frame must survive the next upload');
  if(c.a==='T'){live.add(c.i);frames++;}
 } else if(c.a==='p'){live.add(c.i);frames++;}
 else if(c.a==='d'){assert.equal(c.d,'I');live.delete(c.i);}
 assert(live.size<=3,'image storage must stay bounded');
}
assert.equal(frames,4);assert.equal(live.size,2,'retain the previous frame beneath the latest');
""")

    def test_frames_and_unchanged_resize_do_not_restart_capture(self):
        self.run_js(r"""
cdp.session='s';layoutPicture(false);await cdp.restartCast();calls.length=0;output='';
layoutPicture(false);layoutPicture(true);await pause();
assert(!output.includes('a=d,d=A'),'same geometry must not clear the image');
assert.equal(calls.filter(c=>c.method==='Page.stopScreencast').length,0,'page metadata must not restart the cast');
""")

    def test_resize_restarts_are_serialized_and_coalesced(self):
        self.run_js(r"""
cdp.session='s';const gates=[];
cdp.call=async(method,params,session)=>{calls.push({method,params,session});if(method==='Page.stopScreencast')await new Promise(r=>gates.push(r));return {}};
const first=cdp.restartCast();await pause();S.cols=100;cdp.restartCast();S.cols=90;cdp.restartCast();await pause();
assert.equal(gates.length,1,'only one restart may be in flight');gates.shift()();await pause();
if(gates.length){gates.shift()();await pause();}
await first;
const starts=calls.filter(c=>c.method==='Page.startScreencast');
assert.equal(starts.at(-1).params.maxWidth,900);
assert(starts.length<=2,'coalesce intermediate viewport sizes');
""")

    def test_system_browser_uses_current_http_url_without_automation(self):
        self.run_js(r"""
assert(openSystemBrowser,'system browser fallback available');S.url='https://chatgpt.com/c/example';await openSystemBrowser();
assert.equal(launched.length,1);assert.equal(launched[0].cmd,'xdg-open');assert.equal(launched[0].args[0],S.url);
S.url='javascript:alert(1)';await openSystemBrowser();assert.equal(launched.length,1,'only http(s) pages');
""")

    def test_reconnect_reuses_new_target_instead_of_opening_login_again(self):
        self.run_js(r"""
let created=0;cdp.follow=async()=>{};
cdp.call=async(method)=>{if(method==='Target.getTargets')return {result:{targetInfos:created?[{type:'page',targetId:'new-page'}]:[]}};
if(method==='Target.createTarget'){created++;return {result:{targetId:'new-page'}};}return {};};
cdp.open('ws://unused');await cdp.ws.onopen();
cdp.open('ws://unused');await cdp.ws.onopen();
assert.equal(created,1,'a reconnect must reuse this page, preserving the verification/login flow');
""")

    def test_narrow_toolbar_has_no_negative_or_overlapping_button_positions(self):
        self.run_js(r"""
for(const width of [40,60,80,120]){S.cols=width;bar();let end=0;for(const b of S.buttons){assert(b.x0>=end);assert(b.x1<=width);end=b.x1;}}
""")

    def test_toolbar_refresh_preserves_error_page_recovery_buttons(self):
        self.run_js(r"""
S.state='error';S.why='Disconnected';paint();
assert.equal(S.buttons.filter(b=>b.row<S.rows-1).length,2,'error recovery buttons stay clickable');
const n=S.buttons.length;bar();assert.equal(S.buttons.length,n,'status buttons must not accumulate');
""")
