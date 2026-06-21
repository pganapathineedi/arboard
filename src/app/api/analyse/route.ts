import { NextRequest, NextResponse } from "next/server";
import { ImpactAnalyser } from "@/lib/analysis/ImpactAnalyser";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<Response> {
  let body: { input: string; domainId?: string };

  try {
    body = (await req.json()) as { input: string; domainId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.input?.trim()) {
    return NextResponse.json({ error: "input is required" }, { status: 400 });
  }

  try {
    const analysis = await ImpactAnalyser.analyse(body.input, body.domainId);
    return NextResponse.json(analysis);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
