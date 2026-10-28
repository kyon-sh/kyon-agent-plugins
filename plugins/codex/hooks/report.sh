#!/bin/sh
# Tell Kyon what the agent is doing.
#
# Usage: report.sh <event>   (the agent's hook input JSON arrives on stdin)
#
# Writes one OSC 777 notification to the controlling terminal. Outside a Kyon
# terminal it writes nothing. It never prints on stdout and always exits 0.

agent=codex
plugin_version=3.1.0
event=$1

if [ -z "${KYON_CLI_AGENT_PROTOCOL_VERSION:-}" ] || [ -z "$event" ]; then
	cat >/dev/null 2>&1
	exit 0
fi

native=$(tr -d '\r\n' 2>/dev/null)
case $native in
*[![:space:]]*) ;;
*) native=null ;;
esac

extra=
if [ "$event" = session_start ]; then
	extra=",\"plugin_version\":\"$plugin_version\""
fi
json="{\"v\":1,\"agent\":\"$agent\",\"event\":\"$event\"$extra,\"native\":$native}"

# KYON_TTY replaces the terminal in tests.
tty=${KYON_TTY:-/dev/tty}
if [ -n "${TMUX:-}" ]; then
	{ printf '\033Ptmux;\033\033]777;notify;kyon://cli-agent;%s\007\033\\' "$json" >>"$tty"; } 2>/dev/null
else
	{ printf '\033]777;notify;kyon://cli-agent;%s\007' "$json" >>"$tty"; } 2>/dev/null
fi
exit 0
