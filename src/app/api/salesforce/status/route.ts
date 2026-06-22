import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import type { SessionData } from "@/lib/session";
import { sessionOptions } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const session = await getIronSession<SessionData>(cookies(), sessionOptions);

  if (!session.salesforce?.accessToken) {
    return NextResponse.json({ connected: false });
  }

  const sf = session.salesforce;
  return NextResponse.json({
    connected: true,
    orgName: sf.orgName ?? "Salesforce Org",
    edition: sf.edition ?? "Enterprise",
    isSandbox: sf.isSandbox ?? false,
    instanceUrl: sf.instanceUrl,
    connectedAt: sf.connectedAt,
    hasCachedMetadata: !!session.orgContext,
    cachedAt: session.orgContext?.connectedAt,
  });
}
