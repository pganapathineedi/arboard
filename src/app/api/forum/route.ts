import { NextRequest, NextResponse } from "next/server";
import type { ForumRequest } from "@/lib/types";
import { ForumOrchestrator } from "@/lib/orchestrator/ForumOrchestrator";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest): Promise<Response> {
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
  process.env.ANTHROPIC_API_KEY =
    mode === "real"
      ? (process.env.ANTHROPIC_API_KEY_REAL ?? "")
      : (process.env.ANTHROPIC_API_KEY_MOCK ?? "mock");
  console.log('[route] REAL key present:', !!process.env.ANTHROPIC_API_KEY_REAL, 'ANTHROPIC_API_KEY after set:', process.env.ANTHROPIC_API_KEY?.slice(0, 15));

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        console.log('[route] calling streamForum with mode:', mode);
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
