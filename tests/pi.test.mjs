// Loads the pi extension against a fake pi API and checks what it registers
// and reports. Prints one line per passing check; exits 1 on failure.
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const root = process.argv[2];
const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "kyon-pi-test-"));
const tty = join(dir, "tty");
const mod = await import(pathToFileURL(join(root, "plugins/pi/kyon.js")).href);
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const KYON_ENV = ["KYON_CLI_AGENT_PROTOCOL_VERSION", "KYON_MCP_URL", "KYON_MCP_TOKEN", "KYON_TTY", "TMUX"];

function fakePi() {
	const handlers = new Map();
	const servers = new Map();
	return {
		servers,
		on(event, handler) {
			if (!handlers.has(event)) handlers.set(event, []);
			handlers.get(event).push(handler);
		},
		registerMcpServer(name, config) {
			servers.set(name, config);
		},
		async emit(event, payload, ctx) {
			for (const handler of handlers.get(event) ?? []) await handler(payload, ctx);
		},
		events: () => [...handlers.keys()],
	};
}

const ctx = { cwd: "/work/a b", sessionManager: { getSessionId: () => "pi-session-1" } };

function load(env) {
	for (const key of KYON_ENV) delete process.env[key];
	Object.assign(process.env, env);
	rmSync(tty, { force: true });
	const pi = fakePi();
	mod.default(pi);
	return pi;
}

// Splits the tty file into the JSON payloads of its reports.
function reports(tmux = false) {
	if (!existsSync(tty)) return [];
	let text = readFileSync(tty, "utf8");
	const out = [];
	const open = tmux ? "\x1bPtmux;\x1b\x1b]777;notify;kyon://cli-agent;" : "\x1b]777;notify;kyon://cli-agent;";
	const close = tmux ? "\x07\x1b\\" : "\x07";
	while (text.length) {
		assert.ok(text.startsWith(open), `unexpected bytes: ${JSON.stringify(text.slice(0, 40))}`);
		const end = text.indexOf(close, open.length);
		assert.ok(end > 0, "unterminated report");
		out.push(JSON.parse(text.slice(open.length, end)));
		text = text.slice(end + close.length);
	}
	return out;
}

let failed = false;
async function check(name, fn) {
	try {
		await fn();
		console.log(name);
	} catch (error) {
		failed = true;
		console.log(`FAIL ${name}\n     ${error.stack}`);
	}
}

await check("pi: plugin version matches package.json", () => {
	assert.equal(mod.PLUGIN_VERSION, pkg.version);
});

await check("pi: registers Kyon's MCP server from the environment with the bearer header", () => {
	const pi = load({ KYON_MCP_URL: "http://127.0.0.1:53817/mcp", KYON_MCP_TOKEN: "t0k" });
	const server = pi.servers.get("kyon");
	assert.equal(server.url, "http://127.0.0.1:53817/mcp");
	assert.deepEqual(server.headers, { Authorization: "Bearer t0k" });
});

await check("pi: registers no MCP server and no handlers outside Kyon", () => {
	const pi = load({});
	assert.equal(pi.servers.size, 0);
	assert.deepEqual(pi.events(), []);
});

await check("pi: reports each event with the exact bytes", async () => {
	const pi = load({ KYON_CLI_AGENT_PROTOCOL_VERSION: "1", KYON_TTY: tty });
	await pi.emit("session_start", { reason: "startup" }, ctx);
	await pi.emit("before_agent_start", { messageType: "user", prompt: "fix \"it\"\n" }, ctx);
	await pi.emit("tool_execution_end", { toolCallId: "c1", toolName: "bash", isError: false }, ctx);
	await pi.emit("ui_prompt_start", { reason: "ui_prompt", kind: "confirm", title: "Allow rm?" }, ctx);
	await pi.emit("ui_prompt_end", {}, ctx);
	const messages = [
		{ role: "user", content: [{ type: "text", text: "fix it" }] },
		{ role: "assistant", content: [{ type: "text", text: "Done" }, { type: "text", text: " \u0007ok" }] },
		{ role: "toolResult", content: [] },
	];
	await pi.emit("agent_end", { messages }, ctx);
	await pi.emit("agent_settled", { aborted: true }, ctx);

	const s = { session_id: "pi-session-1", cwd: "/work/a b" };
	const expected = [
		{ v: 1, agent: "pi", event: "session_start", plugin_version: "3.0.0", ...s },
		{ v: 1, agent: "pi", event: "prompt_submit", ...s, query: "fix \"it\"\n" },
		{ v: 1, agent: "pi", event: "tool_complete", ...s, tool_name: "bash" },
		{ v: 1, agent: "pi", event: "question_asked", ...s, summary: "Allow rm?" },
		{ v: 1, agent: "pi", event: "permission_replied", ...s },
		{ v: 1, agent: "pi", event: "stop", ...s, query: "fix \"it\"\n", response: "Done \u0007ok" },
		{ v: 1, agent: "pi", event: "idle_prompt", ...s },
	];
	const bytes = expected.map((r) => `\x1b]777;notify;kyon://cli-agent;${JSON.stringify(r)}\x07`).join("");
	assert.equal(readFileSync(tty, "utf8"), bytes);
	assert.ok(!readFileSync(tty, "utf8").includes("\x07ok"), "control characters inside the JSON are escaped");
	assert.deepEqual(reports(), expected);
});

await check("pi: wraps reports for tmux", async () => {
	const pi = load({ KYON_CLI_AGENT_PROTOCOL_VERSION: "1", KYON_TTY: tty, TMUX: "/tmp/tmux-501/default,1,0" });
	await pi.emit("agent_settled", { aborted: false }, ctx);
	assert.equal(existsSync(tty), false, "a settled run that was not aborted reports nothing");
	await pi.emit("tool_execution_end", { toolName: "read" }, ctx);
	const json = JSON.stringify({ v: 1, agent: "pi", event: "tool_complete", session_id: "pi-session-1", cwd: "/work/a b", tool_name: "read" });
	assert.equal(readFileSync(tty, "utf8"), `\x1bPtmux;\x1b\x1b]777;notify;kyon://cli-agent;${json}\x07\x1b\\`);
	assert.equal(reports(true).length, 1);
});

await check("pi: an unopenable terminal is ignored", async () => {
	const pi = load({ KYON_CLI_AGENT_PROTOCOL_VERSION: "1", KYON_TTY: join(dir, "missing", "tty") });
	await pi.emit("session_start", {}, ctx);
});

await check("pi: frame() matches the shell hooks' framing", () => {
	assert.equal(mod.frame("{}", false), "\x1b]777;notify;kyon://cli-agent;{}\x07");
	assert.equal(mod.frame("{}", true), "\x1bPtmux;\x1b\x1b]777;notify;kyon://cli-agent;{}\x07\x1b\\");
});

rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
