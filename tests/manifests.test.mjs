// Every manifest is valid JSON with the expected names and versions.
// Prints one line per passing check; exits 1 on the first failure.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const root = process.argv[2];
const read = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const check = (name, fn) => {
	try {
		fn();
		console.log(name);
	} catch (error) {
		console.log(`FAIL ${name}\n     ${error.message}`);
		process.exit(1);
	}
};

const VERSION = "3.1.0";

check("claude: marketplace names kyon-agent-plugins with plugin kyon at ./plugins/claude-code", () => {
	const m = read(".claude-plugin/marketplace.json");
	assert.equal(m.name, "kyon-agent-plugins");
	assert.equal(typeof m.owner?.name, "string");
	assert.deepEqual(m.plugins.map((p) => [p.name, p.source]), [["kyon", "./plugins/claude-code"]]);
});

check("claude: plugin.json is kyon 3.1.0", () => {
	const p = read("plugins/claude-code/.claude-plugin/plugin.json");
	assert.equal(p.name, "kyon");
	assert.equal(p.version, VERSION);
	assert.equal(p.license, "MIT");
});

check("claude: hooks.json parses", () => {
	assert.equal(typeof read("plugins/claude-code/hooks/hooks.json").hooks, "object");
});

check("claude: .mcp.json bundles stdio server kyon through the launcher, naming no variable it needs", () => {
	const s = read("plugins/claude-code/.mcp.json").mcpServers;
	assert.deepEqual(Object.keys(s), ["kyon"]);
	assert.deepEqual(s.kyon, { command: "sh", args: ["${CLAUDE_PLUGIN_ROOT}/mcp/kyon.sh"] });
});

check("codex: marketplace names kyon-agent-plugins with plugin kyon at ./plugins/codex", () => {
	const m = read(".agents/plugins/marketplace.json");
	assert.equal(m.name, "kyon-agent-plugins");
	assert.deepEqual(
		m.plugins.map((p) => [p.name, p.source]),
		[["kyon", { source: "local", path: "./plugins/codex" }]],
	);
});

check("codex: plugin.json is kyon 3.1.0 and points at its hooks and MCP config", () => {
	const p = read("plugins/codex/.codex-plugin/plugin.json");
	assert.equal(p.name, "kyon");
	assert.equal(p.version, VERSION);
	assert.equal(p.hooks, "./hooks/hooks.json");
	assert.equal(p.mcpServers, "./.mcp.json");
	read("plugins/codex/hooks/hooks.json");
});

check("codex: .mcp.json bundles stdio server kyon as the launcher, written in", () => {
	const s = read("plugins/codex/.mcp.json").mcpServers;
	assert.deepEqual(Object.keys(s), ["kyon"]);
	assert.equal(s.kyon.command, "/bin/sh");
	assert.equal(s.kyon.args[0], "-c");
	const launcher = readFileSync(join(root, "plugins/claude-code/mcp/kyon.sh"), "utf8")
		.split("\n")
		.filter((l) => !/^\s*#/.test(l))
		.join("\n")
		.trim();
	assert.equal(s.kyon.args[1], launcher + "\n");
	assert.deepEqual(s.kyon.env_vars, ["KYON_MCP_BRIDGE", "KYON_MCP_URL", "KYON_MCP_TOKEN"]);
});

check("pi: package.json is a pi package at version 3.1.0 naming the extension", () => {
	const p = read("package.json");
	assert.equal(p.version, VERSION);
	assert.ok(p.keywords.includes("pi-package"));
	assert.deepEqual(p.pi.extensions, ["./plugins/pi/kyon.js"]);
	readFileSync(join(root, p.pi.extensions[0]));
});
