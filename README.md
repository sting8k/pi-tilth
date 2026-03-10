# pi-tilth

Pi extension that registers [tilth](https://github.com/jahala/tilth) as a native tool for the LLM.

Tilth is an AST-aware code reading CLI powered by tree-sitter. It replaces `read`, `grep`, `find`, and `ls` with a single smart tool that understands code structure — showing definitions first, resolving callee chains, and supporting glob-based file listing.

## Requirements

- [tilth](https://github.com/jahala/tilth) CLI installed and available in PATH

## Install

```bash
pi install sting8k/pi-tilth
```

## Features

- **Tool registration** — `tilth` available as a native Pi tool with structured params (query, scope, section, budget, map)
- **Mode toggle** — `/tilth [on|off]` enables/disables tilth mode, removing built-in tools when active
- **Persistent config** — state saved to `~/.pi/agent/settings.json` under `"pi-tilth"` key
- **Auto-enable** — restores tilth mode on session start based on saved config
- **Styled rendering** — custom `renderCall`/`renderResult` with badge, bold params, and line count summary

## Commands

| Command | Description |
|---------|-------------|
| `/tilth` | Enable tilth mode (default) |
| `/tilth on` | Enable tilth mode |
| `/tilth off` | Disable tilth mode, restore built-in tools |
