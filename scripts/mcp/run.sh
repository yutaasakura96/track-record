#!/bin/sh
# The command an MCP client launches. Claude Desktop and Claude Code start
# servers from a directory of their own choosing, and `tsx` resolves the `~/`
# path alias from the tsconfig.json in the working directory — so this moves to
# the repository root first. Nothing may print to stdout before the server
# does: stdout is the protocol.
cd "$(dirname "$0")/../.." || exit 1
exec ./node_modules/.bin/tsx scripts/mcp-server.ts "$@"
