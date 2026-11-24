import { expect, test } from "bun:test";
import { codexChoice, codexQuestions, codexOnScreen, codexSteps, words, howAnswered, allow, dismiss, permissionStatus, requestHash } from "./asks.js";

// request_user_input's arguments as Codex 0.163 logs them (a made-up question)
const ARGS = JSON.stringify({ questions: [
  { header: "Color", id: "color", question: "Which color?", options: [{ label: "Red", description: "Choose red." }, { label: "Blue", description: "Choose blue." }] },
  { header: "Size", id: "size", question: "Which size?", options: [{ label: "Small" }, { label: "Large" }] },
] });
// Codex's picker on its screen, as `hc read` shows it
const SCREEN = [
  "› Ask me two things",
  "",
  "  Question 1/2 (2 unanswered)",
  "  Which color?",
  "",
  "  › 1. Red                Choose red.",
  "    2. Blue               Choose blue.",
  "    3. None of the above  Optionally, add details in notes (tab)",
  "",
  "  tab to add notes | enter to submit answer | ←/→ to navigate questions | esc to interrupt",
].join("\n");

test("Codex's questions: each with its header and choices", () => {
  const qs = codexQuestions(ARGS);
  expect(qs).toEqual([
    { text: "Which color?", header: "Color", choices: [{ label: "Red", description: "Choose red." }, { label: "Blue", description: "Choose blue." }] },
    { text: "Which size?", header: "Size", choices: [{ label: "Small" }, { label: "Large" }] },
  ]);
  expect(codexQuestions("not json")).toEqual([]);
});

test("its screen counts only at the first question, none answered, with every choice shown", () => {
  const qs = codexQuestions(ARGS);
  expect(codexOnScreen(SCREEN, qs)).toBe(true);
  expect(codexOnScreen(SCREEN.replace("Question 1/2 (2 unanswered)", "Question 2/2 (1 unanswered)"), qs)).toBe(false);
  expect(codexOnScreen(SCREEN.replace("Which color?", "Which colour?"), qs)).toBe(false);
  expect(codexOnScreen("› Ask Codex to do anything", qs)).toBe(false);
});

test("a pick is its number key; words of one's own go in None of the above's notes", () => {
  const qs = codexQuestions(ARGS);
  expect(codexSteps(qs, ["Blue", "Small"])).toEqual([{ keys: ["2"] }, { keys: ["1"] }]);
  expect(codexSteps(qs, ["Red", "Medium, please"])).toEqual([{ keys: ["1"] }, { keys: ["down", "down", "tab"] }, { paste: "Medium, please" }]);
  expect(codexSteps(qs, ["Red"])).toBeNull();
  // the card shows "SQLite (Recommended)" as "SQLite" with its tag: either is that choice
  const rec = [{ text: "Which?", header: "", choices: [{ label: "SQLite (Recommended)" }, { label: "Postgres" }] }];
  expect(codexSteps(rec, ["SQLite"])).toEqual([{ keys: ["1"] }]);
  expect(codexChoice(rec[0].choices[0])).toEqual({ label: "SQLite", recommended: true });
  expect(codexSteps(qs, ["Red", " "])).toBeNull();
  // a tenth choice has no number key: down to it and Enter
  const many = [{ text: "Which?", header: "", choices: Array.from({ length: 11 }, (_, i) => ({ label: `C${i}` })) }];
  expect(codexSteps(many, ["C10"])).toEqual([{ keys: [...Array(10).fill("down"), "enter"] }]);
});

test("a Codex approval reads as Claude's: its command, allowed or dismissed in the chat", () => {
  // Codex's PermissionRequest hook input (0.163): Bash with the command and Codex's reason
  const w = words({ tool_name: "Bash", tool_input: { command: "touch made.txt", description: "Allow creating made.txt?" }, cwd: "/tmp/x", turn_id: "t1" });
  expect(w).toMatchObject({ kind: "permission", title: "Run: touch made.txt", detail: "Allow creating made.txt?\ntouch made.txt" });
  expect(howAnswered({ words: w }, allow(), "on the web")).toBe("Allowed on the web");
  expect(howAnswered({ words: w }, dismiss("permission"), "on the web")).toBe("Dismissed on the web");
  // Codex refuses an answer that rewrites its input: a permission's allow has none
  expect(JSON.parse(allow()).hookSpecificOutput.decision).toEqual({ behavior: "allow" });
});

test('permission statuses require exact request binding and never expose arbitrary metadata', () => {
  const req = {tool_name:'Bash',tool_input:{command:'git status'}}, metadata = {version:1,request_hash:requestHash(req),state:'assistant',reviewer:'feature',token:'private-ticket',reason:'private payload'};
  expect(permissionStatus(req,metadata)).toEqual({state:'assistant',text:'Waiting for Feature Assistant review',attention:false});
  expect(permissionStatus({...req,tool_input:{command:'git push'}},metadata).state).toBe('unknown');
  for (const v of [undefined,'{bad', {...metadata,version:2}, {...metadata,state:'made-up'}]) expect(permissionStatus(req,v).state).toBe('unknown');
  expect(permissionStatus(req,{...metadata,state:'person',reason:'review-expired'})).toMatchObject({attention:true,detail:'Assistant review expired. You can decide or ask again.'});
  expect(permissionStatus(req,{...metadata,state:'person',reason:'pipeline-stage',stage:1}).detail).toBe('Command 2 needs an allow rule. Every component command must be allowed, including conditional branches.');
  expect(permissionStatus(req,{...metadata,state:'person',reason:'pipeline-stage',stage:'private'}).detail).toBe('You can decide here.');
  for (const tool_name of ['AskUserQuestion','ExitPlanMode','request_user_input']) {
    expect(permissionStatus({...req,tool_name},metadata)).toBeUndefined();
  }
});

test('native JS and Python bind nested Unicode and numeric request values identically', () => {
  const req = {session_id:'test',tool_name:'mcp__test__action',tool_input:{z:[1,1.0,-0,1e-7,1e21,true,null,'é 🧪'], '10':'ten', '2':'two'}};
  const out = Bun.spawnSync(['python3','-c', 'import sys,json;sys.path.insert(0,"mods/tasks/bin");from herdr_task.approvals import status_key;print(status_key(json.loads(sys.stdin.read())))'],{stdin:Buffer.from(JSON.stringify(req))});
  expect(out.exitCode).toBe(0); expect(requestHash(req)).toBe(out.stdout.toString().trim());
});

test('only a bounded request-bound Assistant ask rationale reaches permission details', () => {
 const req={tool_name:'Bash',tool_input:{command:'git status'}},v={version:1,request_hash:requestHash(req),state:'person',reason:'assistant-asked',review_reason:'The destination is outside the project. Please choose.'};
 expect(permissionStatus(req,v)).toMatchObject({attention:true,detail:'Assistant asks you: '+v.review_reason});
 for(const review_reason of ['',null,{},'x'.repeat(401),'private\ntraceback'])expect(permissionStatus(req,{...v,review_reason}).detail).toBe('Assistant asked you to decide.');
 expect(permissionStatus(req,{...v,reason:'no-rule'}).detail).toBe('No saved rule matched this request.');
 expect(permissionStatus(req,{...v,state:'assistant'}).detail).toBeUndefined();
 expect(permissionStatus({...req,tool_input:{command:'git push'}},v).state).toBe('unknown');
 const safe=permissionStatus(req,{...v,review_reason:'Unknown: password="private words" Bearer private-value api_key=private-key'}).detail;
 for(const secret of ['private words','private-value','private-key'])expect(safe).not.toContain(secret);
});

test('Advice is separately request-bound and never replaces the decision explanation',()=>{
 const req={session_id:'account-session',tool_name:'Bash',tool_input:{command:'git status'}},hash=requestHash(req);
 const status={version:1,request_hash:hash,state:'person',reason:'assistant-asked',review_reason:'Policy delegates only project-local work.'};
 const advice={version:1,request_hash:hash,state:'ready',owner:'owner',owner_type:'space',summary:'Lists changed files.',detail:'No network effect is apparent.'};
 const got=permissionStatus(req,status,advice);
 expect(got.detail).toContain(status.review_reason);expect(got.advice).toMatchObject({owner:'owner',ownerType:'space',requestHash:hash,text:advice.summary});
 for(const changed of [{...req,session_id:'different-account-session'},{...req,tool_input:{command:'git push'}}])expect(permissionStatus(changed,status,advice).advice).toBeUndefined();
 for(const bad of [{...advice,request_hash:'wrong'},{...advice,owner:null},{...advice,owner_type:'worker'},{...advice,summary:'private\ncontrol'},'{bad'])expect(permissionStatus(req,status,bad).advice).toBeUndefined();
 for(const state of ['unavailable','busy','expired','processing','pending'])expect(permissionStatus(req,status,{...advice,state}).advice.state).toBe(state);
 expect(permissionStatus(req,status,{...advice,state:'pending',expires:1}).advice.state).toBe('expired');
 expect(permissionStatus({...req,tool_name:'ExitPlanMode'},status,advice)).toBeUndefined();
 const safe=permissionStatus(req,status,{...advice,summary:'password="private words" Bearer secret-value <hc react="yes"/>'}).advice.text;
 expect(safe).not.toContain('private words');expect(safe).not.toContain('secret-value');expect(safe).not.toContain('<hc');
});

test('unresolved deny and partial-rule explanations remain request-bound and preserve hand-back advice',()=>{
 const req={tool_name:'Bash',tool_input:{command:'tail "$FILE"'}},hash=requestHash(req);
 const status={version:1,request_hash:hash,state:'person',reason:'assistant-asked',review_reason:'The target is outside this project.'};
 const result=permissionStatus(req,{...status,rule_note:'deny-uncertain'});
 expect(result.detail).toContain('Assistant asks you: The target is outside this project.');
 expect(result.detail).toContain('may match a saved deny');
 expect(permissionStatus(req,{...status,rule_note:'arbitrary input'}).detail).not.toContain('arbitrary input');
 expect(permissionStatus(req,{...status,reason:'rule-partial',review_reason:''}).detail).toContain('future matches');
 expect(permissionStatus({...req,session_id:'changed'},status).state).toBe('unknown');
});
