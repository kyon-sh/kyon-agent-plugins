#!/bin/sh
# Run every check. Usage: sh tests/run.sh
# Needs a POSIX sh and node (for JSON and the pi extension).
# SH=dash sh tests/run.sh runs the hooks under another shell.

root=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/kyon-plugins-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT INT TERM

passed=0
failed=0
ok() { passed=$((passed + 1)); printf 'ok   %s\n' "$1"; }
fail() { failed=$((failed + 1)); printf 'FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '     %s\n' "$2"; }

# expect_report <name> <tty file> <json> [tmux]
# Compares the tty file with the exact bytes of one report.
expect_report() {
	if [ -n "${4:-}" ]; then
		printf '\033Ptmux;\033\033]777;notify;kyon://cli-agent;%s\007\033\\' "$3" >"$tmp/expected"
	else
		printf '\033]777;notify;kyon://cli-agent;%s\007' "$3" >"$tmp/expected"
	fi
	if cmp -s "$tmp/expected" "$2"; then
		ok "$1"
	else
		fail "$1" "got: $(od -c "$2" 2>/dev/null | head -5 | tr '\n' ' ')"
	fi
}

# agent_marker <agent dir>: what the agent itself sets for its hooks.
agent_marker() {
	case $1 in
	claude-code) echo CLAUDECODE=1 ;;
	*) echo KYON_NOTHING= ;;
	esac
}

# run_hook <agent dir> <event> <stdin> [extra env assignments...]
# Runs report.sh with a test tty; leaves $tmp/tty, $tmp/out, $tmp/err, $rc.
run_hook() {
	dir=$1 event=$2 input=$3
	shift 3
	rm -f "$tmp/tty"
	printf '%s' "$input" | env -u TMUX -u CLAUDECODE KYON_CLI_AGENT_PROTOCOL_VERSION=1 KYON_TTY="$tmp/tty" \
		$(agent_marker "$dir") "$@" \
		${SH:-sh} "$root/plugins/$dir/hooks/report.sh" "$event" >"$tmp/out" 2>"$tmp/err"
	rc=$?
}

quiet() { # quiet <name>: exit 0, nothing on stdout or stderr
	if [ "$rc" -eq 0 ] && [ ! -s "$tmp/out" ] && [ ! -s "$tmp/err" ]; then ok "$1"; else fail "$1" "rc=$rc out=$(cat "$tmp/out") err=$(cat "$tmp/err")"; fi
}

sample='{"session_id":"s-1","cwd":"/work/a b",
"prompt":"fix the \"bug\" 100%\\n","tool_input":{"description":"run tests"}}
'
sample_line='{"session_id":"s-1","cwd":"/work/a b","prompt":"fix the \"bug\" 100%\\n","tool_input":{"description":"run tests"}}'

echo "# shell hooks"
for pair in claude-code:claude codex:codex; do
	dir=${pair%%:*} agent=${pair#*:}

	run_hook "$dir" stop "$sample"
	expect_report "$dir: stop report bytes" "$tmp/tty" "{\"v\":1,\"agent\":\"$agent\",\"event\":\"stop\",\"native\":$sample_line}"
	quiet "$dir: stop is silent and exits 0"

	run_hook "$dir" session_start "$sample"
	expect_report "$dir: session_start carries plugin_version" "$tmp/tty" "{\"v\":1,\"agent\":\"$agent\",\"event\":\"session_start\",\"plugin_version\":\"3.1.1\",\"native\":$sample_line}"

	run_hook "$dir" prompt_submit ''
	expect_report "$dir: empty stdin gives native null" "$tmp/tty" "{\"v\":1,\"agent\":\"$agent\",\"event\":\"prompt_submit\",\"native\":null}"

	run_hook "$dir" tool_complete "$sample" TMUX=/tmp/tmux-501/default,1,0
	expect_report "$dir: tmux passthrough" "$tmp/tty" "{\"v\":1,\"agent\":\"$agent\",\"event\":\"tool_complete\",\"native\":$sample_line}" tmux

	rm -f "$tmp/tty"
	printf '%s' "$sample" | env -u KYON_CLI_AGENT_PROTOCOL_VERSION -u TMUX KYON_TTY="$tmp/tty" \
		${SH:-sh} "$root/plugins/$dir/hooks/report.sh" stop >"$tmp/out" 2>"$tmp/err"
	rc=$?
	if [ ! -e "$tmp/tty" ]; then ok "$dir: nothing written outside Kyon"; else fail "$dir: nothing written outside Kyon"; fi
	quiet "$dir: outside Kyon exits 0 silently"

	run_hook "$dir" stop "$sample" KYON_TTY="$tmp/missing/dir/tty"
	quiet "$dir: unopenable tty exits 0 silently"
done

# Claude Code's hooks copied into another agent: nothing said, nothing printed.
rm -f "$tmp/tty"
printf '%s' "$sample" | env -u TMUX -u CLAUDECODE KYON_CLI_AGENT_PROTOCOL_VERSION=1 KYON_TTY="$tmp/tty" \
	${SH:-sh} "$root/plugins/claude-code/hooks/report.sh" tool_complete >"$tmp/out" 2>"$tmp/err"
rc=$?
if [ ! -e "$tmp/tty" ]; then ok "claude-code: run by another agent, nothing is reported"; else fail "claude-code: run by another agent, nothing is reported"; fi
quiet "claude-code: run by another agent, it exits 0 silently"

echo "# hook configuration runs the right events"
# hook_table <hooks.json>: one "Event[:matcher]<TAB>command" line per hook.
hook_table() {
	node -e '
		const f = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
		for (const [ev, groups] of Object.entries(f.hooks))
			for (const g of groups)
				for (const h of g.hooks)
					console.log(ev + (g.matcher ? ":" + g.matcher : "") + "\t" + h.command);
	' "$1"
}
check_hooks() { # check_hooks <dir> <agent> <expected "Event=event" pairs...>
	dir=$1 agent=$2
	shift 2
	hook_table "$root/plugins/$dir/hooks/hooks.json" >"$tmp/table" || { fail "$dir: hooks.json parses"; return; }
	n=0
	for want in "$@"; do
		key=${want%%=*} ev=${want#*=}
		cmd=$(awk -F '\t' -v k="$key" '$1 == k { print $2 }' "$tmp/table")
		if [ -z "$cmd" ]; then fail "$dir: $key is hooked"; continue; fi
		rm -f "$tmp/tty"
		printf '%s' "$sample" | env -u TMUX -u CLAUDECODE KYON_CLI_AGENT_PROTOCOL_VERSION=1 KYON_TTY="$tmp/tty" \
			$(agent_marker "$dir") \
			CLAUDE_PLUGIN_ROOT="$root/plugins/$dir" PLUGIN_ROOT="$root/plugins/$dir" \
			${SH:-sh} -c "$cmd" >"$tmp/out" 2>"$tmp/err"
		rc=$?
		extra=
		[ "$ev" = session_start ] && extra=',"plugin_version":"3.1.1"'
		expect_report "$dir: $key -> $ev" "$tmp/tty" "{\"v\":1,\"agent\":\"$agent\",\"event\":\"$ev\"$extra,\"native\":$sample_line}"
		quiet "$dir: $key hook is silent"
		n=$((n + 1))
	done
	total=$(wc -l <"$tmp/table" | tr -d ' ')
	if [ "$total" -eq "$n" ]; then ok "$dir: no unexpected hooks"; else fail "$dir: no unexpected hooks" "$total hooks, $n expected"; fi
}
check_hooks claude-code claude \
	SessionStart=session_start UserPromptSubmit=prompt_submit PostToolUse=tool_complete \
	PermissionRequest=permission_request Notification:permission_prompt=permission_request Stop=stop
check_hooks codex codex \
	SessionStart=session_start UserPromptSubmit=prompt_submit PermissionRequest=permission_request \
	PostToolUse=tool_complete Stop=stop Interrupt=idle_prompt

echo "# manifests"
if node "$root/tests/manifests.test.mjs" "$root" >"$tmp/out" 2>&1; then
	sed 's/^/ok   /' "$tmp/out"
	passed=$((passed + $(wc -l <"$tmp/out")))
else
	cat "$tmp/out"
	fail "manifests"
fi

echo "# MCP command"
# spawn_mcp <agent dir> <input>: runs the configured kyon server command as
# the agent would, with no shell in between, and prints "<status>:<stdout>";
# stderr passes through.
spawn_mcp() {
	CLAUDE_PLUGIN_ROOT="$root/plugins/$1" node -e '
		const fs = require("fs"), cp = require("child_process");
		const s = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).mcpServers.kyon;
		const args = s.args.map((a) => a.replace("${CLAUDE_PLUGIN_ROOT}", process.env.CLAUDE_PLUGIN_ROOT));
		const r = cp.spawnSync(s.command, args, { encoding: "utf8", timeout: 5000, input: process.argv[2] });
		process.stderr.write(r.stderr);
		process.stdout.write(r.status + ":" + r.stdout);
	' "$root/plugins/$1/.mcp.json" "$2"
}
handshake='{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"method":"tools/list","params":{},"jsonrpc":"2.0","id":"l-1"}
{"jsonrpc":"2.0","id":2,"method":"ping"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"x"}}'
answers='0:{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"kyon","version":"3.1.1"},"instructions":"Not in a Kyon terminal, so Kyon'"'"'s tools are not available."}}
{"jsonrpc":"2.0","id":"l-1","result":{"tools":[]}}
{"jsonrpc":"2.0","id":2,"result":{}}
{"jsonrpc":"2.0","id":3,"error":{"code":-32601,"message":"not in a Kyon terminal"}}'

mkdir -p "$tmp/bridge dir"
printf '#!/bin/sh\nprintf "%%s|" "$@"\n' >"$tmp/bridge dir/kyon"
chmod +x "$tmp/bridge dir/kyon"
for dir in claude-code codex; do
	out=$( (unset KYON_MCP_BRIDGE KYON_MCP_URL KYON_MCP_TOKEN; spawn_mcp "$dir" "$handshake") 2>"$tmp/err")
	if [ "$out" = "$answers" ] && [ ! -s "$tmp/err" ]; then
		ok "$dir: outside Kyon the MCP command is a server with no tools"
	else
		fail "$dir: outside Kyon the MCP command is a server with no tools" "got: $out $(cat "$tmp/err")"
	fi
	out=$(KYON_MCP_BRIDGE="$tmp/bridge dir/kyon" spawn_mcp "$dir" "")
	if [ "$out" = "0:mcp-bridge|" ]; then
		ok "$dir: MCP command execs the bridge (path with a space) with mcp-bridge"
	else
		fail "$dir: MCP command execs the bridge" "got: $out"
	fi
done

echo "# pi extension"
if node "$root/tests/pi.test.mjs" "$root" >"$tmp/out" 2>&1; then
	sed 's/^/ok   /' "$tmp/out"
	passed=$((passed + $(wc -l <"$tmp/out")))
else
	cat "$tmp/out"
	fail "pi extension"
fi

echo
echo "$passed passed, $failed failed"
[ "$failed" -eq 0 ]
