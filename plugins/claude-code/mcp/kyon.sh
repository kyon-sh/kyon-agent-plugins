#!/bin/sh
# Kyon's MCP server, for an agent running in a Kyon terminal: Kyon's bridge
# forwards each message to the server that terminal names. Anywhere else this
# answers as a server with no tools, so the agent has nothing to report as
# failed. Messages are JSON-RPC, one a line.
if [ -n "${KYON_MCP_BRIDGE:-}" ]; then
	exec "$KYON_MCP_BRIDGE" mcp-bridge
fi
field() { # field <name> <line>: a string or number value of that key
	printf '%s\n' "$2" | sed -n -E "s/.*\"$1\"[[:space:]]*:[[:space:]]*(\"[^\"]*\"|-?[0-9]+).*/\\1/p"
}
while IFS= read -r line || [ -n "$line" ]; do
	id=$(field id "$line")
	[ -n "$id" ] || continue
	case $(field method "$line") in
	'"initialize"')
		version=$(field protocolVersion "$line")
		result="{\"protocolVersion\":${version:-\"2025-06-18\"},\"capabilities\":{\"tools\":{}},\"serverInfo\":{\"name\":\"kyon\",\"version\":\"3.1.0\"},\"instructions\":\"Not in a Kyon terminal, so Kyon's tools are not available.\"}"
		;;
	'"tools/list"') result='{"tools":[]}' ;;
	'"ping"') result='{}' ;;
	*)
		printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32601,"message":"not in a Kyon terminal"}}\n' "$id"
		continue
		;;
	esac
	printf '{"jsonrpc":"2.0","id":%s,"result":%s}\n' "$id" "$result"
done
