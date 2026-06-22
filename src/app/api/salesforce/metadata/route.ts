import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import type { SessionData } from "@/lib/session";
import { sessionOptions } from "@/lib/session";
import { OrgMetadataCollector } from "@/lib/salesforce/OrgMetadataCollector";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(): Promise<Response> {
  const session = await getIronSession<SessionData>(cookies(), sessionOptions);

  if (!session.salesforce?.accessToken) {
    return NextResponse.json({ error: "Not connected to Salesforce" }, { status: 401 });
  }

  try {
    const collector = new OrgMetadataCollector(session.salesforce);
    const orgContext = await collector.collect();

    session.orgContext = orgContext;
    await session.save();

    return NextResponse.json(orgContext);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Metadata collection failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
