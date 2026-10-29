# Kyon agent plugins

Plugins for coding agents that run inside a [Kyon](https://github.com/kyon-sh) terminal:
Claude Code, Codex and pi. While the agent runs in a Kyon terminal, its plugin

1. **reports what the agent is doing**, so Kyon can show whether it is working,
   waiting for you, or done, and
2. **gives the agent Kyon's MCP server**, so the agent can call Kyon's tools.

Outside a Kyon terminal the plugins do nothing visible: no output, no errors,
no slowdown.
The Claude Code plugin's hooks act only for Claude Code itself, so a setup that
copies Claude Code's hooks into another agent reports nothing from them there.

Kyon installs the right plugin for you. To install one by hand:

## Claude Code

```sh
claude plugin marketplace add kyon-sh/kyon-agent-plugins
claude plugin install kyon@kyon-agent-plugins
```

The plugin lives in `plugins/claude-code`. Its hooks report session start,
prompt submission, tool completion, permission prompts and the end of each
turn. It bundles a stdio MCP server named `kyon`, `mcp/kyon.sh`: in a Kyon
terminal it runs `"$KYON_MCP_BRIDGE" mcp-bridge`, a program Kyon provides that
forwards MCP to Kyon's server. Outside Kyon it answers as a server with no
tools, so nothing shows as failed.

## Codex

```sh
codex plugin marketplace add kyon-sh/kyon-agent-plugins
codex plugin add kyon@kyon-agent-plugins
```

The plugin lives in `plugins/codex`. Its hooks report session start, prompt
submission, permission requests, tool completion, the end of each turn and
interruptions. Codex may ask you to review and trust the plugin's hooks before
they run.

It bundles the same stdio MCP server as the Claude Code plugin, written into
`.mcp.json`: Kyon's bridge in a Kyon terminal, a server with no tools
elsewhere.

## pi

```sh
pi install git:github.com/kyon-sh/kyon-agent-plugins
```

The package's extension is `plugins/pi/kyon.js`, named in the `pi` key of the
root `package.json`. It reports session start, the start of each run, tool
completion, extension prompts that wait for you, and the end of each run with
the agent's last answer. In a Kyon terminal it registers Kyon's MCP server as
`kyon` at `KYON_MCP_URL`, with the bearer token.

## Environment

Kyon sets these in every terminal. The plugins treat any of them as possibly
missing.

| Variable | Used for |
|---|---|
| `KYON_CLI_AGENT_PROTOCOL_VERSION` | Set in a Kyon terminal. When unset, nothing is reported. |
| `KYON_CLIENT_VERSION` | Kyon's version, for information only. |
| `KYON_MCP_URL` | Kyon's MCP server for this terminal (streamable HTTP). |
| `KYON_MCP_TOKEN` | The bearer token for that server. |
| `KYON_MCP_BRIDGE` | A program that serves Kyon's MCP over stdio when run as `"$KYON_MCP_BRIDGE" mcp-bridge`. |
| `TMUX` | When set, reports are wrapped in tmux passthrough so they reach the outer terminal. |
| `KYON_TTY` | For tests only: a file to write reports to instead of `/dev/tty`. |

## How reports work

A report is one OSC 777 notification written to the controlling terminal
(`/dev/tty`), never to standard output:

```
ESC ] 777 ; notify ; kyon://cli-agent ; {"v":1,"agent":"claude","event":"stop","native":{...}} BEL
```

The shell hooks pass the agent's own hook input through as `native`, so they
need nothing beyond a POSIX shell. A hook always exits 0 and prints nothing.

## Tests

```sh
sh tests/run.sh
```

The tests need a POSIX shell and Node.js. `SH=dash sh tests/run.sh` runs the
hooks under another shell.

## Licence

MIT. Copyright (c) 2026 Ryowave. See [LICENSE](LICENSE).
