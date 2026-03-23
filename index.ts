import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text } from "@mariozechner/pi-tui";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const REPLACED_TOOLS = ["read", "grep", "find", "ls"];
const SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");
const MAX_PREVIEW_LINES = 10;

function shortenPath(path: string): string {
    const home = homedir();
    if (path.startsWith(home)) return `~${path.slice(home.length)}`;
    return path;
}

function getTextOutput(result: any): string {
    if (!result?.content) return "";
    return result.content
        .filter((c: any) => c.type === "text")
        .map((c: any) => String(c.text ?? ""))
        .join("\n")
        .replace(/\r/g, "");
}

function countLines(text: string): number {
    const normalized = (text ?? "").replace(/\r/g, "").replace(/\n+$/g, "");
    if (!normalized) return 0;
    return normalized.split("\n").length;
}

function readSettings(): Record<string, any> {
    try {
        if (existsSync(SETTINGS_PATH)) {
            return JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
        }
    } catch { }
    return {};
}

function isEnabled(): boolean {
    const settings = readSettings();
    return settings["pi-tilth"]?.enabled !== false; // default: true
}

function setEnabled(enabled: boolean): void {
    try {
        const settings = readSettings();
        settings["pi-tilth"] = { ...settings["pi-tilth"], enabled };
        writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
    } catch { }
}

let savedTools: string[] | null = null;

function enableTilth(pi: ExtensionAPI): string[] {
    const currentTools = pi.getActiveTools();
    savedTools = [...currentTools];
    const filtered = currentTools.filter((t: string) => !REPLACED_TOOLS.includes(t));
    if (!filtered.includes("tilth")) {
        filtered.push("tilth");
    }
    pi.setActiveTools(filtered);
    return currentTools.filter((t: string) => REPLACED_TOOLS.includes(t));
}

function disableTilth(pi: ExtensionAPI): void {
    if (savedTools) {
        const restored = savedTools.filter((t: string) => t !== "tilth");
        pi.setActiveTools(restored);
        savedTools = null;
    }
}

const tilthSchema = Type.Object({
    query: Type.String({
        description:
            "File path to read, symbol name to search for, glob pattern (e.g. '*.ts'), plain text to search, or slash-wrapped regex content search (e.g. '/handle(Auth|Login)/'). " +
            "For symbol search, provide the symbol name and set scope to the directory to search in. " +
            "For file reading, provide the file path.",
    }),
    scope: Type.Optional(
        Type.String({
            description: "Directory to search within or resolve relative paths against. Defaults to current directory.",
        }),
    ),
    section: Type.Optional(
        Type.String({
            description: 'Line range (e.g. "45-89") or markdown heading (e.g. "## Architecture") to read a specific section.',
        }),
    ),
    budget: Type.Optional(
        Type.Number({
            description: "Max tokens in response. Use for large files to limit output. Recommended: 500 for overview, 2000 for detail.",
        }),
    ),
    map: Type.Optional(
        Type.Boolean({
            description: "If true, generate a structural codebase map (file names + top-level symbols) instead of searching. Use once for orientation.",
        }),
    ),
});

export default function tilthExtension(pi: ExtensionAPI) {
    pi.registerTool({
        name: "tilth",
        label: "tilth",
        description:
            "AST-aware smart code reading tool. Use this for ALL code reading and navigation tasks: " +
            "reading files, finding symbol definitions, searching for patterns, exploring project structure. " +
            "This tool understands code structure via tree-sitter and shows definitions first (not just string matches), " +
            "with callee chains for following call flows. " +
            "Query types: file path to read, symbol name to find definitions, " +
            "glob pattern (e.g. '*.ts') to list matching files, " +
            "plain text to search content (strings, comments, TODOs), or slash-wrapped regex for content search. " +
            "Supports: Rust, TypeScript, JavaScript, Python, Go, Java, C, C++, Ruby. " +
            "Important: each search handles ONE symbol/query — run separate calls for different symbols. " +
            "Tips: search for symbol name directly instead of reading entire files; " +
            "use budget=500 for large files then section to drill in; " +
            "use map=true once at start for orientation.",
        promptSnippet:
            "AST-aware code reading and search. Prefer tilth over read/grep/find/ls for file reads, symbol lookup, glob listing, and text or /regex/ search. Handle one query at a time; use scope, section, budget, and map=true for orientation.",
        parameters: tilthSchema,

        async execute(_toolCallId, params, signal, _onUpdate, ctx) {
            if (!isEnabled()) {
                return {
                    content: [{ type: "text" as const, text: "Tilth mode is OFF. Use /tilth to enable, or use read/grep/find/ls instead." }],
                    isError: true,
                };
            }

            const args: string[] = [];

            if (params.map) {
                args.push("--map");
            }

            if (params.query && !params.map) {
                args.push(params.query);
            }

            args.push("--scope", params.scope ?? ctx.cwd);

            if (params.section) {
                args.push("--section", params.section);
            }

            if (params.budget) {
                args.push("--budget", String(params.budget));
            }

            const result = await pi.exec("tilth", args, {
                timeout: 30000,
                cwd: ctx.cwd,
            });

            if (signal?.aborted) {
                return {
                    content: [{ type: "text" as const, text: "Cancelled" }],
                    isError: true,
                };
            }

            if (result.code !== 0) {
                const errorMsg = result.stderr?.trim() || result.stdout?.trim() || "tilth command failed";
                return {
                    content: [{ type: "text" as const, text: errorMsg }],
                    isError: true,
                };
            }

            return {
                content: [{ type: "text" as const, text: result.stdout }],
            };
        },

        renderCall(args: any, theme: any) {
            let detail: string;
            if (args?.map) {
                const scope = args.scope ? shortenPath(args.scope) : ".";
                detail = `map ${scope}`;
            } else {
                const query = String(args?.query ?? "");
                const scope = args?.scope ? shortenPath(args.scope) : "";
                const section = args?.section ? `, §${args.section}` : "";
                const budget = args?.budget ? `, ${args.budget}` : "";
                detail = scope ? `${query}, ${scope}${section}${budget}` : `${query}${section}${budget}`;
            }
            return new Text(`tilth (${theme.bold(detail)})`, 0, 0);
        },

        renderResult(result: any, options: any, theme: any) {
            const output = getTextOutput(result).trimEnd();

            if (result.isError) {
                return new Text(`${theme.fg("error", output || "Error")}`, 0, 0);
            }

            const lineCount =
                typeof result.details?.truncation?.outputLines === "number"
                    ? result.details.truncation.outputLines
                    : countLines(output);

            const summary = `↳ ${lineCount} ${lineCount === 1 ? "line" : "lines"}.`;

            if (!output) {
                return new Text(theme.fg("dim", summary), 0, 0);
            }

            if (options?.expanded) {
                const lines = output.split("\n");
                const body = lines.map((l: string) => theme.fg("toolOutput", l)).join("\n");
                return new Text(`${theme.fg("dim", summary)}\n${body}`, 0, 0);
            }

            const lines = output.split("\n");
            if (lines.length <= MAX_PREVIEW_LINES) {
                return new Text(theme.fg("dim", summary), 0, 0);
            }

            return new Text(theme.fg("dim", summary), 0, 0);
        },
    });

    // Detect bash calls using rg/grep/cat/find/fd and nudge toward tilth
    const NUDGE_CMD = /(?:^|\|)\s*(rg|ripgrep|grep|egrep|fgrep|cat|head|tail|less|find|fd|locate)\s/;
    const REMOTE_CMD = /(?:^|\s)(ssh|sshpass|scp|rsync|docker\s+exec|kubectl\s+exec|nohup\s+ssh)\s/;
    const NUDGE_HINT = "\n\n[tilth] Hint: consider using the `tilth` tool instead of raw shell commands for code reading/searching — it provides AST-aware results with better context.";

    pi.on("tool_result", async (event) => {
        if (event.toolName !== "bash" || event.isError || !isEnabled()) return;
        const command = (event.input as Record<string, unknown>)?.command;
        if (typeof command !== "string" || !NUDGE_CMD.test(command)) return;
        // Skip remote commands — tilth only works locally
        if (REMOTE_CMD.test(command)) return;



        const newContent = (event.content ?? []).map((c, i, arr) => {
            if (i === arr.length - 1 && c.type === "text") {
                return { type: "text" as const, text: c.text + NUDGE_HINT };
            }
            return c;
        });

        return { content: newContent };
    });


    // Auto-scaffold config and enable on session start
    pi.on("session_start", async (_event, _ctx) => {
        const settings = readSettings();
        if (!settings["pi-tilth"]) {
            setEnabled(true);
        }
        if (isEnabled()) {
            enableTilth(pi);
        }
    });

    pi.registerCommand("tilth", {
        description: "Toggle tilth mode — replaces read/grep/find/ls with tilth tool",
        handler: async (args, ctx) => {
            const subcommand = args?.trim().toLowerCase() ?? "";

            if (subcommand === "off") {
                disableTilth(pi);
                setEnabled(false);
                ctx.ui.notify("Tilth mode OFF — built-in tools restored", "info");
                return;
            }

            if (subcommand === "" || subcommand === "on") {
                if (savedTools) {
                    ctx.ui.notify("Tilth mode is already active", "warning");
                    return;
                }
                const removed = enableTilth(pi);
                setEnabled(true);
                ctx.ui.notify(
                    `Tilth mode ON\nDisabled: ${removed.join(", ") || "(none found)"}`,
                    "info",
                );
                return;
            }

            ctx.ui.notify("Usage: /tilth [on|off]", "warning");
        },
    });
}

