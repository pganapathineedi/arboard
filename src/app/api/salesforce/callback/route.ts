import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import jsforce from "jsforce";
import type { SessionData } from "@/lib/session";
import { sessionOptions } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<Response> {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(`${origin}/salesforce/connected?error=${encodeURIComponent(error ?? "cancelled")}`);
  }

  const clientId = process.env.SF_CLIENT_ID;
  const clientSecret = process.env.SF_CLIENT_SECRET;
  const redirectUri = process.env.SF_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.redirect(`${origin}/salesforce/connected?error=not_configured`);
  }

  try {
    const conn = new jsforce.Connection({
      oauth2: { loginUrl: "https://login.salesforce.com", clientId, clientSecret, redirectUri },
    });

    await conn.authorize(code);

    let orgName = "Salesforce Org";
    let edition = "Enterprise";
    let isSandbox = false;

    try {
      const orgRes = await conn.query<{ Name: string; OrganizationType: string; IsSandbox: boolean }>(
        "SELECT Name, OrganizationType, IsSandbox FROM Organization LIMIT 1"
      );
      const org = orgRes.records[0];
      if (org) { orgName = org.Name; edition = org.OrganizationType; isSandbox = org.IsSandbox; }
    } catch { /* non-fatal */ }

    const session = await getIronSession<SessionData>(cookies(), sessionOptions);
    session.salesforce = {
      accessToken: conn.accessToken!,
      refreshToken: conn.refreshToken ?? undefined,
      instanceUrl: conn.instanceUrl,
      orgName,
      edition,
      isSandbox,
      connectedAt: new Date().toISOString(),
    };
    await session.save();

    return NextResponse.redirect(`${origin}/salesforce/connected`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "oauth_error";
    return NextResponse.redirect(`${origin}/salesforce/connected?error=${encodeURIComponent(msg)}`);
  }
}
