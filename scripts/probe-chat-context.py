#!/usr/bin/env python3
"""SHEP-55: run an installed Codex against a synthetic, loopback-only model.

This is a research probe, NOT a history editing command. No session IDs, account
directories, endpoints or prompts are accepted as arguments. All sessions, model
responses and credentials-free config are temporary. No historical tools run.
Requires an installed Codex with App Server and access to a loopback socket.
"""
import json
import os
from pathlib import Path
import queue
import re
import shutil
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


KEEP = "KEEP_EARLIER_USER"
KEEP_REPLY = "KEEP_EARLIER_REPLY"
MISTAKE = "MISTAKEN_USER"
MISTAKE_REPLY = "MISTAKEN_ASSISTANT"
TOOL_INPUT = "MISTAKEN_TOOL_ARGUMENT"
TOOL_OUTPUT = "MISTAKEN_TOOL_RESULT"
PARTIAL = "MISTAKEN_PARTIAL_REPLY"
NEXT = "CONTINUATION"
LATER = "KEEP_LATER_USER"
LATER_REPLY = "KEEP_LATER_REPLY"
QUEUED = "WITHDRAW_THIS_QUEUED_PROMPT"
COMPACT_PRIOR = "COMPACTED_PRIOR"
COMPACT_MISTAKE = "COMPACTED_WITH_MISTAKE"


def msg(role, text):
    return {"type": "message", "role": role, "content": [
        {"type": "input_text" if role == "user" else "output_text", "text": text}
    ]}


def text_of(item):
    return "\n".join(c.get("text", "") for c in item.get("content", [])
                     if c.get("type") in ("input_text", "output_text"))


def contains(items, marker):
    return marker in json.dumps(items)


class Model(ThreadingHTTPServer):
    def __init__(self):
        super().__init__(("127.0.0.1", 0), Handler)
        self.requests = []
        self.pause = threading.Event()
        self.release = threading.Event()
        self.tool_count = 0
        self.daemon_threads = True


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_POST(self):
        # Only the Responses API route is emulated; unexpected requests fail.
        if self.path != "/v1/responses":
            self.send_error(404)
            return
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        model = self.server
        items = body["input"]
        model.requests.append(items)
        number = len(model.requests)
        user = next(text_of(item) for item in reversed(items)
                    if item.get("type") == "message" and item.get("role") == "user")
        mistaken = user in (MISTAKE, MISTAKE + "_INTERRUPT")
        has_result = any(i.get("type") == "function_call_output" and
                         contains([i], TOOL_OUTPUT) for i in items)
        pause = mistaken and user.endswith("_INTERRUPT") and has_result
        if mistaken and not has_result:
            item = {"type": "function_call", "id": f"fc_{number}",
                    "name": "fixture_lookup", "call_id": f"call_{number}",
                    "arguments": json.dumps({"fixture": TOOL_INPUT}), "status": "completed"}
        else:
            text = (PARTIAL if pause else MISTAKE_REPLY if mistaken else KEEP_REPLY
                    if user == KEEP else LATER_REPLY if user == LATER else "FIXTURE_OK")
            if user.startswith("You are performing a CONTEXT CHECKPOINT COMPACTION"):
                text = COMPACT_MISTAKE if contains(items, MISTAKE) else COMPACT_PRIOR
            item = {**msg("assistant", text), "id": f"msg_{number}", "status": "completed",
                    "phase": "commentary" if pause else "final_answer"}
        response = {"id": f"resp_{number}", "object": "response", "status": "completed",
                    "model": body["model"], "output": [item], "usage": {
                        "input_tokens": 100, "output_tokens": 10, "total_tokens": 110,
                        "input_tokens_details": {"cached_tokens": 0},
                        "output_tokens_details": {"reasoning_tokens": 0}}}
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()

        def event(value):
            self.wfile.write(("data: " + json.dumps(value) + "\n\n").encode())
            self.wfile.flush()

        try:
            event({"type": "response.created", "response": {**response, "status": "in_progress", "output": []}})
            event({"type": "response.output_item.added", "output_index": 0, "item": item})
            event({"type": "response.output_item.done", "output_index": 0, "item": item})
            if pause:
                # Codex sees a completed commentary item inside a turn whose
                # response never finishes until the test has interrupted it.
                model.pause.set()
                model.release.wait(15)
            else:
                event({"type": "response.completed", "response": response})
        except (BrokenPipeError, ConnectionResetError):
            pass


class AppServer:
    def __init__(self, root, model, binary):
        self.model = model
        self.home = root / "home"
        self.codex_home = self.home / ".codex"
        self.project = root / "project"
        self.codex_home.mkdir(parents=True, exist_ok=True)
        self.project.mkdir(exist_ok=True)
        (self.codex_home / "config.toml").write_text(f'''model = "gpt-5.4"
model_provider = "fixture"
model_reasoning_effort = "low"
web_search = "disabled"
[model_providers.fixture]
name = "Fixture"
base_url = "http://127.0.0.1:{model.server_port}/v1"
wire_api = "responses"
supports_websockets = false
[analytics]
enabled = false
[projects."{self.project}"]
trust_level = "trusted"
''')
        # Never inherit real provider tokens, account settings, hooks or MCP config.
        env = {"HOME": str(self.home), "CODEX_HOME": str(self.codex_home),
               "PATH": os.environ["PATH"], "LANG": "C.UTF-8",
               **{f"XDG_{key}_HOME": str(self.home / key.lower())
                  for key in ("CONFIG", "CACHE", "DATA", "STATE")}}
        self.stderr = (root / "server.stderr").open("ab")
        self.proc = subprocess.Popen([binary, "app-server", "--listen", "stdio://"],
                                     cwd=self.project, env=env, stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=self.stderr, text=True)
        self.incoming = queue.Queue()
        self.serial = 0
        self.events = []

        def read():
            try:
                for line in self.proc.stdout:
                    self.incoming.put(json.loads(line))
            finally:
                self.incoming.put(None)

        self.reader = threading.Thread(target=read, daemon=True)
        self.reader.start()
        try:
            self.rpc("initialize", {"clientInfo": {"name": "shep_context_fixture", "version": "1"},
                                    "capabilities": {"experimentalApi": True, "requestAttestation": False}})
            self.write({"method": "initialized"})
        except BaseException:
            self.close()
            raise

    def close(self):
        if self.stderr.closed:
            return
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait()
        self.reader.join(timeout=2)
        self.proc.stdin.close()
        self.proc.stdout.close()
        self.stderr.close()

    def write(self, value):
        self.proc.stdin.write(json.dumps(value) + "\n")
        self.proc.stdin.flush()

    def receive(self, deadline):
        response = self.incoming.get(timeout=max(0.01, deadline - time.monotonic()))
        if response is None:
            raise RuntimeError("fixture app-server exited")
        if "method" in response:
            self.events.append(response)
            if "id" in response:
                assert response["method"] == "item/tool/call", "unexpected server request"
                request = response["params"]
                assert request["tool"] == "fixture_lookup" and request["arguments"] == {"fixture": TOOL_INPUT}
                self.model.tool_count += 1
                # Return a synthetic value, not a shell command or external tool.
                self.write({"id": response["id"], "result": {
                    "success": True, "contentItems": [{"type": "inputText", "text": TOOL_OUTPUT}]}})
        return response

    def rpc(self, method, params, *, error=False):
        self.serial += 1
        request_id = self.serial
        self.write({"id": request_id, "method": method, "params": params})
        deadline = time.monotonic() + 30
        while True:
            response = self.receive(deadline)
            if response.get("id") == request_id and "method" not in response:
                if error:
                    assert "error" in response, method
                    return response["error"]
                if "error" in response:
                    raise RuntimeError(f"{method}: {response['error']}")
                return response["result"]

    def thread(self, mode, tools=False):
        params = {"cwd": str(self.project), "model": "gpt-5.4", "modelProvider": "fixture",
                  "approvalPolicy": "never", "sandbox": "read-only", "historyMode": mode}
        if tools:
            params["dynamicTools"] = [{"type": "function", "name": "fixture_lookup",
                "description": "Synthetic fixture returning one constant string.",
                "inputSchema": {"type": "object", "properties": {"fixture": {"type": "string"}},
                                "required": ["fixture"], "additionalProperties": False}}]
        thread = self.rpc("thread/start", params)["thread"]
        assert thread["historyMode"] == mode
        return thread["id"]

    def start_turn(self, thread, text):
        return self.rpc("turn/start", {"threadId": thread, "input": [
            {"type": "text", "text": text, "text_elements": []}]})["turn"]["id"]

    def wait_event(self, predicate):
        deadline = time.monotonic() + 30
        while True:
            for event in self.events:
                if predicate(event):
                    return event
            self.receive(deadline)

    def finish(self, thread, turn, status="completed"):
        event = self.wait_event(lambda e: e["method"] == "turn/completed" and
            e["params"]["threadId"] == thread and e["params"]["turn"]["id"] == turn)
        assert event["params"]["turn"]["status"] == status, event["params"]["turn"]
        return turn

    def turn(self, thread, text):
        return self.finish(thread, self.start_turn(thread, text))

    def items(self, thread, mode):
        if mode == "legacy":
            turns = self.rpc("thread/read", {"threadId": thread, "includeTurns": True})["thread"]["turns"]
            return [dict(turnId=t["id"], item=i) for t in turns for i in t["items"]]
        params = {"threadId": thread, "sortDirection": "asc", "limit": 2}
        result = []
        while True:
            page = self.rpc("thread/items/list", params)
            result.extend(page["data"])
            cursor = page.get("nextCursor")
            if not cursor:
                return result
            assert cursor != params.get("cursor"), "pagination did not advance"
            params["cursor"] = cursor

    def resume(self, thread):
        return self.rpc("thread/resume", {"threadId": thread, "excludeTurns": True})["thread"]

    def compact(self, thread):
        completed = {e["params"]["turn"]["id"] for e in self.events if e["method"] == "turn/completed"}
        self.rpc("thread/compact/start", {"threadId": thread})
        e = self.wait_event(lambda e: e["method"] == "turn/completed" and
            e["params"]["threadId"] == thread and e["params"]["turn"]["id"] not in completed)
        assert e["params"]["turn"]["status"] == "completed", e["params"]["turn"]

    def chat_rows(self, thread):
        # Exercise the actual shared native/web log reader on the provider's
        # generated scratch rollout, including its paginated base segments.
        path = self.rpc("thread/read", {"threadId": thread})["thread"]["path"]
        assert Path(path).resolve().is_relative_to(self.codex_home.resolve())
        js = """
import {LOG, records, Conversation, discardableTurn} from './core/chat-log.js';
import {sessionOf} from './core/agents.js';
import {spawnSync} from 'node:child_process';
const path = process.argv[1];
const p = spawnSync('sh', ['-c', LOG, 'log', 'page', path, '999999999999999', '200'], {encoding:'utf8'});
if (p.status !== 0) throw new Error('Could not read synthetic rollout');
const r = records(p.stdout).records, conv = new Conversation('codex');
conv.feed(r);
console.log(JSON.stringify({rows: conv.items.filter(i => i.kind === 'user' || i.kind === 'agent').map(i => [i.kind,i.text]),
candidate: discardableTurn(r, sessionOf('codex',path))}));
"""
        return json.loads(subprocess.check_output(["node", "--input-type=module", "-e", js, path],
            cwd=Path(__file__).resolve().parents[1], text=True))


def report(label, items):
    # Print only the fixture values, never model instructions or local paths.
    markers = {KEEP, KEEP_REPLY, MISTAKE, MISTAKE + "_INTERRUPT", MISTAKE_REPLY,
               PARTIAL, NEXT, LATER, LATER_REPLY}
    messages = [f"{i.get('role')}: {text_of(i)}" for i in items
                if i.get("type") == "message" and text_of(i) in markers]
    print(f"{label}: {' | '.join(messages)}", flush=True)


def assert_clean(items):
    expected = [("user", KEEP), ("assistant", KEEP_REPLY), ("user", NEXT)]
    roles = [(i.get("role"), text_of(i)) for i in items if i.get("type") == "message"
             and text_of(i) in (KEEP, KEEP_REPLY, NEXT)]
    assert roles == expected, roles
    for marker in (MISTAKE, MISTAKE_REPLY, TOOL_INPUT, TOOL_OUTPUT, PARTIAL):
        assert not contains(items, marker), f"discarded context still sent: {marker}"
    assert not any(i.get("type") in ("function_call", "function_call_output") for i in items)


def test_latest(root, model, binary, mode, interrupted):
    app = AppServer(root, model, binary)
    model.pause.clear()
    model.release.clear()
    try:
        source = app.thread(mode, tools=True)
        app.turn(source, KEEP)
        wrong = app.start_turn(source, MISTAKE + ("_INTERRUPT" if interrupted else ""))
        if interrupted:
            app.wait_event(lambda e: e["method"] == "item/completed"
                           and e["params"]["threadId"] == source
                           and e["params"]["item"].get("text") == PARTIAL)
            assert model.pause.is_set()
            # Require an explicit interrupt and an acknowledged terminal turn
            # state instead of relying on whether a particular server rejects
            # or implicitly stops a revert while work is still running.
            state = app.rpc("thread/read", {"threadId": source})["thread"]["status"]
            assert state["type"] == "active", state
            queued = app.rpc("thread/queue/add", {"threadId": source, "clientUserMessageId": "fixture-queued",
                "input": [{"type": "text", "text": QUEUED, "text_elements": []}]})["queuedSubmission"]
            assert any(q["id"] == queued["id"] for q in app.rpc("thread/queue/list", {"threadId": source})["data"])
            assert app.rpc("thread/queue/delete", {"threadId": source, "queuedSubmissionId": queued["id"]})["deleted"]
            assert not app.rpc("thread/queue/list", {"threadId": source})["data"]
            print("  Queued prompt withdrawn by provider ID before model delivery.", flush=True)
            print("  Active turn observed; interrupting before discard.", flush=True)
            app.rpc("turn/interrupt", {"threadId": source, "turnId": wrong})
            app.finish(source, wrong, "interrupted")
            model.release.set()
        else:
            app.finish(source, wrong)
        prior_input = model.requests[-1]
        assert contains(prior_input, MISTAKE) and contains(prior_input, TOOL_INPUT) and contains(prior_input, TOOL_OUTPUT)
        entries = app.items(source, mode)
        assert any(e["item"].get("text") == (PARTIAL if interrupted else MISTAKE_REPLY) for e in entries)
        if mode == "paginated":
            assert any(e["item"]["type"] == "dynamicToolCall" for e in entries)
        shown = app.chat_rows(source)
        assert shown["candidate"] and shown["candidate"]["closed"], shown["candidate"]
        # A control fork of the entire source shows that the same next prompt
        # WOULD receive the mistaken context if nothing had been discarded.
        control = app.rpc("thread/fork", {"threadId": source, "excludeTurns": True,
                          "deferGoalContinuation": True})["thread"]["id"]
        app.turn(control, NEXT)
        before = model.requests[-1]
        for marker in (MISTAKE, TOOL_INPUT, TOOL_OUTPUT, PARTIAL if interrupted else MISTAKE_REPLY):
            assert contains(before, marker), f"control did not retain {marker}"
        report(f"{mode} {'interrupted' if interrupted else 'completed'} without discard", before)
        print("  Tool call + result and final/partial assistant item in actual control input.", flush=True)
        request_count, tool_count = len(model.requests), model.tool_count
        if mode == "paginated":
            result = app.rpc("thread/revert", {"threadId": source, "beforeTurnId": wrong})
            target = result["thread"]["id"]
            assert target == source
        else:
            error = app.rpc("thread/revert", {"threadId": source, "beforeTurnId": wrong}, error=True)
            assert "paginated" in error["message"], error
            target = app.rpc("thread/fork", {"threadId": source, "beforeTurnId": wrong,
                             "excludeTurns": True, "deferGoalContinuation": True})["thread"]["id"]
            assert target != source
        assert len(model.requests) == request_count and model.tool_count == tool_count
        app.close()
        app = AppServer(root, model, binary)
        app.resume(target)
        app.turn(target, NEXT)
        after = model.requests[-1]
        assert_clean(after)
        assert not contains(after, QUEUED)
        shown = app.chat_rows(target)
        assert shown["rows"] == [["user", KEEP], ["agent", KEEP_REPLY],
                                 ["user", NEXT], ["agent", "FIXTURE_OK"]], shown["rows"]
        print("  Shared Chat reader displays the retained prefix plus continuation, not discarded rows.", flush=True)
        report(f"{mode} {'interrupted' if interrupted else 'completed'} after restart", after)
        assert model.tool_count == tool_count, "historical tool was executed again"
        print("  PASS: exact earlier roles retained; mistaken prompt, assistant and tool context absent; no replay.", flush=True)
        if mode == "legacy":
            app.resume(source)
            app.turn(source, "CHECK_ORIGINAL")
            assert contains(model.requests[-1], MISTAKE)
            print("  Original thread remains resumable.", flush=True)
    finally:
        app.close()
        model.release.set()


def test_older(root, model, binary, mode):
    app = AppServer(root, model, binary)
    try:
        source = app.thread(mode)
        app.turn(source, KEEP)
        # The tool-free adjacent messages below test the documented append-only
        # import separately from native turn discard. Do not import unseen context.
        app.turn(source, "OLDER_USER")
        app.turn(source, LATER)
        rows = app.items(source, mode)
        assert len(rows) == 6
        items = []
        for row in rows:
            item = row["item"]
            if item["type"] == "userMessage":
                assert len(item["content"]) == 1 and item["content"][0]["type"] == "text"
                items.append(msg("user", item["content"][0]["text"]))
            else:
                assert item["type"] == "agentMessage"
                items.append({**msg("assistant", item["text"]), "phase": item["phase"]})
        for index in (2, 3):
            selected = rows[index]["item"]["id"]
            assert sum(row["item"]["id"] == selected for row in rows) == 1
            retained = [item for row, item in zip(rows, items) if row["item"]["id"] != selected]
            target = app.thread(mode)
            requests = len(model.requests)
            app.rpc("thread/inject_items", {"threadId": target, "items": retained})
            assert len(model.requests) == requests
            app.close()
            app = AppServer(root, model, binary)
            app.resume(target)
            app.turn(target, NEXT)
            expected = [(i["role"], text_of(i)) for i in retained + [msg("user", NEXT)]]
            want = {text_of(i) for i in items + [msg("user", NEXT)]}
            actual = [(i.get("role"), text_of(i)) for i in model.requests[-1]
                      if i.get("type") == "message" and text_of(i) in want]
            # FIFO roles/order, not whether a model guesses a marker.
            assert actual == expected, (actual, expected)
            assert target != source
            assert len(app.items(target, mode)) == 2, "imported items unexpectedly exposed as original turns"
            print(f"{mode} older {items[index]['role']} omission: PASS; exact retained text roles/order in new thread; "
                  "injected history is not exposed as ordinary turns.", flush=True)
    finally:
        app.close()


def test_compaction(root, model, binary):
    app = AppServer(root, model, binary)
    try:
        source = app.thread("paginated")
        app.turn(source, KEEP)
        app.compact(source)
        # A mistaken turn after compaction must rewind to the already
        # compacted preceding state, not rebuild from visible text.
        wrong = app.turn(source, "MISTAKEN_USER_NO_TOOL")
        assert contains(model.requests[-1], COMPACT_PRIOR)
        app.compact(source)
        control = app.rpc("thread/fork", {"threadId": source, "excludeTurns": True,
                          "deferGoalContinuation": True})["thread"]["id"]
        app.turn(control, NEXT)
        assert contains(model.requests[-1], COMPACT_MISTAKE)
        app.rpc("thread/revert", {"threadId": source, "beforeTurnId": wrong})
        app.close()
        app = AppServer(root, model, binary)
        app.resume(source)
        app.turn(source, NEXT)
        assert contains(model.requests[-1], COMPACT_PRIOR)
        assert not contains(model.requests[-1], COMPACT_MISTAKE)
        assert not contains(model.requests[-1], "MISTAKEN_USER_NO_TOOL")
        print("Compacted paginated history: preceding summary retained; summary made after mistake excluded.", flush=True)
    finally:
        app.close()


def main():
    binary = shutil.which("codex")
    if not binary:
        raise SystemExit("Codex CLI is not installed")
    # No provider config or auth is read for the version command.
    with tempfile.TemporaryDirectory(prefix="shep-context-") as folder:
        root = Path(folder)
        version = subprocess.check_output([binary, "--version"], text=True,
                                          env={"HOME": folder, "CODEX_HOME": folder, "PATH": os.environ["PATH"]}).strip()
        print(version, flush=True)
        schema = root / "schema"
        schema.mkdir()
        subprocess.run([binary, "app-server", "generate-ts", "--experimental", "--out", str(schema)],
                       env={"HOME": folder, "CODEX_HOME": folder, "PATH": os.environ["PATH"]}, check=True)
        methods = re.findall(r'"method": "([^"]+)"', (schema / "ClientRequest.ts").read_text())
        print("History methods:", ", ".join(m for m in methods if m in {
            "thread/revert", "thread/fork", "thread/inject_items", "thread/turns/list",
            "thread/items/list", "thread/items/read", "thread/delete", "thread/queue/delete"}), flush=True)
        assert not any(re.search(r"^(thread/items|item|turn/items)/(delete|remove)$", m) for m in methods)
        model = Model()
        worker = threading.Thread(target=model.serve_forever, daemon=True)
        worker.start()
        try:
            for mode in ("paginated", "legacy"):
                for interrupted in (False, True):
                    test_latest(root / f"{mode}-{interrupted}", model, binary, mode, interrupted)
                test_older(root / f"{mode}-older", model, binary, mode)
            test_compaction(root / "compacted", model, binary)
        finally:
            model.release.set()
            model.shutdown()
            model.server_close()
            worker.join(timeout=5)
    print("All synthetic context assertions passed.", flush=True)


if __name__ == "__main__":
    main()
