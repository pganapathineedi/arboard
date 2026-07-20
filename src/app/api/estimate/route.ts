import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth/requireApiKey";

export async function POST(req: NextRequest) {
  const authError = requireApiKey(req);
  if (authError) return authError;

  if (!process.env.ESTIMATOR_URL) {
    return NextResponse.json({ error: "Estimator not configured" }, { status: 503 });
  }

  const body = await req.json();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const upstream = await fetch(process.env.ESTIMATOR_URL + "/api/v1/estimate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ESTIMATOR_API_KEY ?? "",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!upstream.ok) {
      return NextResponse.json({ error: `Estimator returned ${upstream.status}` }, { status: upstream.status });
    }
    const data = await upstream.json();
    return NextResponse.json(data);
  } catch (err) {
    console.warn("[estimate] proxy failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Estimator unavailable" }, { status: 503 });
  } finally {
    clearTimeout(timeout);
  }
}
