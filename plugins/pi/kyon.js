// Kyon extension for pi.
//
// In a Kyon terminal it reports what pi is doing, as OSC 777 notifications
// written to the controlling terminal, and registers Kyon's MCP server.
// Outside a Kyon terminal it does nothing.

import { closeSync, openSync, writeSync } from "node:fs";

export const PLUGIN_VERSION = "3.1.1";

const PREFIX = "\x1b]777;notify;kyon://cli-agent;";
const BEL = "\x07";

/** The bytes of one report, wrapped for tmux when `tmux` is true. */
export function frame(json, tmux) {
	const seq = PREFIX + json + BEL;
	if (!tmux) return seq;
	return "\x1bPtmux;" + seq.replaceAll("\x1b", "\x1b\x1b") + "\x1b\\";
}

function report(fields, env = process.env) {
	if (!env.KYON_CLI_AGENT_PROTOCOL_VERSION) return;
	const json = JSON.stringify({ v: 1, agent: "pi", ...fields });
	const bytes = Buffer.from(frame(json, Boolean(env.TMUX)), "utf8");
	let fd;
	try {
		// KYON_TTY replaces the terminal in tests.
		fd = openSync(env.KYON_TTY || "/dev/tty", "a");
		// One write, so the sequence never interleaves with pi's own drawing.
		writeSync(fd, bytes);
	} catch {
		// No terminal: nothing to report to.
	} finally {
		if (fd !== undefined) {
			try {
				closeSync(fd);
			} catch {}
		}
	}
}

function sessionFields(ctx) {
	const fields = {};
	try {
		const id = ctx?.sessionManager?.getSessionId?.();
		if (id) fields.session_id = String(id);
	} catch {}
	if (typeof ctx?.cwd === "string") fields.cwd = ctx.cwd;
	return fields;
}

function lastAssistantText(messages) {
	if (!Array.isArray(messages)) return undefined;
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role !== "assistant") continue;
		const content = message.content;
		if (typeof content === "string") return content;
		if (!Array.isArray(content)) continue;
		const text = content
			.filter((part) => part?.type === "text" && typeof part.text === "string")
			.map((part) => part.text)
			.join("");
		if (text) return text;
	}
	return undefined;
}

export default function kyon(pi) {
	const env = process.env;

	if (env.KYON_MCP_URL && typeof pi.registerMcpServer === "function") {
		const config = { url: env.KYON_MCP_URL, description: "Kyon, the terminal this agent runs in" };
		if (env.KYON_MCP_TOKEN) config.headers = { Authorization: `Bearer ${env.KYON_MCP_TOKEN}` };
		try {
			pi.registerMcpServer("kyon", config);
		} catch {
			// A server named "kyon" in mcp.json, or an older pi: leave it be.
		}
	}

	if (!env.KYON_CLI_AGENT_PROTOCOL_VERSION) return;

	let query;

	pi.on("session_start", (_event, ctx) => {
		report({ event: "session_start", plugin_version: PLUGIN_VERSION, ...sessionFields(ctx) });
	});

	pi.on("before_agent_start", (event, ctx) => {
		query = typeof event?.prompt === "string" ? event.prompt : undefined;
		report({ event: "prompt_submit", ...sessionFields(ctx), ...(query !== undefined && { query }) });
	});

	pi.on("tool_execution_end", (event, ctx) => {
		report({ event: "tool_complete", ...sessionFields(ctx), ...(event?.toolName && { tool_name: event.toolName }) });
	});

	pi.on("ui_prompt_start", (event, ctx) => {
		report({ event: "question_asked", ...sessionFields(ctx), ...(event?.title && { summary: event.title }) });
	});

	pi.on("ui_prompt_end", (_event, ctx) => {
		report({ event: "permission_replied", ...sessionFields(ctx) });
	});

	pi.on("agent_end", (event, ctx) => {
		const response = lastAssistantText(event?.messages);
		report({
			event: "stop",
			...sessionFields(ctx),
			...(query !== undefined && { query }),
			...(response !== undefined && { response }),
		});
	});

	pi.on("agent_settled", (event, ctx) => {
		if (event?.aborted) report({ event: "idle_prompt", ...sessionFields(ctx) });
	});
}
