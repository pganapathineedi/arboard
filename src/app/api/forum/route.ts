import { NextRequest, NextResponse } from "next/server";
import type { ForumRequest } from "@/lib/types";
import { ForumOrchestrator } from "@/lib/orchestrator/ForumOrchestrator";
import { requireApiKey } from "@/lib/auth/requireApiKey";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest): Promise<Response> {
  const authError = requireApiKey(req)
  if (authError) return authError
  let body: ForumRequest;

  try {
    body = (await req.json()) as ForumRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.input || body.input.trim().length === 0) {
    return NextResponse.json({ error: "input is required" }, { status: 400 });
  }

  const mode = (body as { mode?: string }).mode === "real" ? "real" : "mock";
  const apiKey = mode === "real"
    ? (process.env.ANTHROPIC_API_KEY_REAL ?? "")
    : (process.env.ANTHROPIC_API_KEY_MOCK ?? "mock")
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        // TODO: pass apiKey into analyser instead of process.env
        for await (const chunk of ForumOrchestrator.streamForum(body, mode)) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Stream error";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "error", error: message })}\n\n`)
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
