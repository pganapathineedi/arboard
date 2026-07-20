#!/usr/bin/env node
"use strict";
/**
 * ARBoard MCP Server
 * Exposes ARBoard's multi-agent review pipeline to Claude Desktop.
 *
 * Build:  npx tsc --project tsconfig.mcp.json
 * Run:    node dist-mcp/mcp-server.js
 */
Object.defineProperty(exports, "__esModule", { value: true });
const readline_1 = require("readline");
const ARBOARD_BASE_URL = process.env.ARBOARD_URL ?? "http://localhost:3000";
const ARBOARD_API_KEY = process.env.ARBOARD_API_KEY ?? "";
function send(msg) {
    process.stdout.write(JSON.stringify(msg) + "\n");
}
function ok(id, result) {
    send({ jsonrpc: "2.0", id, result });
}
function err(id, code, message) {
    send({ jsonrpc: "2.0", id, error: { code, message } });
}
// ── Tool definitions ──────────────────────────────────────────────────────────
const TOOLS = [
    {
        name: "arboard_review",
        description: "Submit a Salesforce Solution Design Document (SDD) or architecture text to ARBoard's multi-agent review pipeline. Returns a structured review with findings, risk ratings, and ADR recommendations from specialist agents (Designer, LWC, OmniStudio, Flow, Apex, Patterns, Integration, Data, Agentforce).",
        inputSchema: {
            type: "object",
            properties: {
                content: {
                    type: "string",
                    description: "The SDD or architecture document text to review.",
                },
                title: {
                    type: "string",
                    description: "Optional document title shown in the review output.",
                },
                domain: {
                    type: "string",
                    description: "Salesforce domain context, e.g. 'telecommunications', 'financial-services', 'public-sector'. Defaults to 'general'.",
                },
            },
            required: ["content"],
        },
    },
    {
        name: "arboard_health",
        description: "Check whether the ARBoard server is running and reachable.",
        inputSchema: {
            type: "object",
            properties: {},
            required: [],
        },
    },
];
// ── Tool handlers ─────────────────────────────────────────────────────────────
async function handleReview(args) {
    const { content, title = "Untitled SDD", domain = "general" } = args;
    const headers = {
        "Content-Type": "application/json",
    };
    if (ARBOARD_API_KEY)
        headers["x-api-key"] = ARBOARD_API_KEY;
    const res = await fetch(`${ARBOARD_BASE_URL}/api/v1/review`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content, title, domain }),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`ARBoard returned ${res.status}: ${text}`);
    }
    // /api/v1/review returns newline-delimited SSE or JSON — handle both
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream")) {
        // Collect all SSE data lines and return the last non-empty one
        const raw = await res.text();
        const lines = raw
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.replace(/^data:\s*/, "").trim())
            .filter(Boolean);
        return lines.at(-1) ?? "(no output)";
    }
    const json = await res.json();
    return typeof json === "string" ? json : JSON.stringify(json, null, 2);
}
async function handleHealth() {
    try {
        const res = await fetch(`${ARBOARD_BASE_URL}/api/health`, {
            signal: AbortSignal.timeout(5000),
        });
        if (res.ok)
            return "ARBoard is running and reachable.";
        return `ARBoard responded with status ${res.status}.`;
    }
    catch (e) {
        return `ARBoard is not reachable at ${ARBOARD_BASE_URL}. Make sure 'npm run dev' is running.`;
    }
}
// ── Request dispatcher ────────────────────────────────────────────────────────
async function dispatch(req) {
    const { id, method, params = {} } = req;
    switch (method) {
        case "initialize":
            return ok(id, {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "arboard-mcp", version: "1.0.0" },
            });
        case "tools/list":
            return ok(id, { tools: TOOLS });
        case "tools/call": {
            const { name, arguments: args = {} } = params;
            try {
                let text;
                if (name === "arboard_review")
                    text = await handleReview(args);
                else if (name === "arboard_health")
                    text = await handleHealth();
                else
                    return err(id, -32601, `Unknown tool: ${name}`);
                return ok(id, {
                    content: [{ type: "text", text }],
                });
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                return ok(id, {
                    content: [{ type: "text", text: `Error: ${msg}` }],
                    isError: true,
                });
            }
        }
        case "notifications/initialized":
            return; // no response needed
        default:
            return err(id, -32601, `Method not found: ${method}`);
    }
}
// ── Stdio loop ────────────────────────────────────────────────────────────────
const rl = (0, readline_1.createInterface)({ input: process.stdin });
rl.on("line", async (line) => {
    const trimmed = line.trim();
    if (!trimmed)
        return;
    try {
        const req = JSON.parse(trimmed);
        await dispatch(req);
    }
    catch {
        send({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Parse error" },
        });
    }
});
