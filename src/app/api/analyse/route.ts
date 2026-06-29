import { NextRequest, NextResponse } from "next/server";
import { ImpactAnalyser } from "@/lib/analysis/ImpactAnalyser";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<Response> {
  console.log('[analyse] POST called');
  let body: { input?: string; documentText?: string; domainId?: string; mode?: string };

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const mode = body.mode === "real" ? "real" : "mock";
  process.env.ANTHROPIC_API_KEY =
    mode === "real"
      ? (process.env.ANTHROPIC_API_KEY_REAL ?? "")
      : (process.env.ANTHROPIC_API_KEY_MOCK ?? "mock");
  console.log("API KEY being used:", process.env.ANTHROPIC_API_KEY?.substring(0, 20));

  const input = body.documentText ?? body.input ?? "";
  if (!input.trim()) {
    return NextResponse.json({ error: "input or documentText is required" }, { status: 400 });
  }

  try {
    const analysis = await ImpactAnalyser.analyse(input, body.domainId);
    return NextResponse.json(analysis);
  } catch (err) {
    console.error("analyse error:", err);
    const message = err instanceof Error ? err.message : "Analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
