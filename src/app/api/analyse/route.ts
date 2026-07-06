import { NextRequest, NextResponse } from "next/server";
import { ImpactAnalyser } from "@/lib/analysis/ImpactAnalyser";
import { requireApiKey } from "@/lib/auth/requireApiKey";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<Response> {
  const authError = requireApiKey(req)
  if (authError) return authError
  console.log('[analyse] POST called');
  let body: { input?: string; documentText?: string; domainId?: string; mode?: string };

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const mode = body.mode === "real" ? "real" : "mock";
  const apiKey = mode === "real"
    ? (process.env.ANTHROPIC_API_KEY_REAL ?? "")
    : (process.env.ANTHROPIC_API_KEY_MOCK ?? "mock")

  const input = body.documentText ?? body.input ?? "";
  if (!input.trim()) {
    return NextResponse.json({ error: "input or documentText is required" }, { status: 400 });
  }

  try {
    const analysis = await ImpactAnalyser.analyse(input, body.domainId, undefined, mode);
    return NextResponse.json(analysis);
  } catch (err) {
    console.error("analyse error:", err);
    const message = err instanceof Error ? err.message : "Analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
