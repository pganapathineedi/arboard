import { NextResponse } from "next/server";
import jsforce from "jsforce";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const clientId = process.env.SF_CLIENT_ID;
  const clientSecret = process.env.SF_CLIENT_SECRET;
  const redirectUri = process.env.SF_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json(
      { error: "Salesforce Connected App not configured. Set SF_CLIENT_ID, SF_CLIENT_SECRET, SF_REDIRECT_URI in .env.local" },
      { status: 503 }
    );
  }

  const oauth2 = new jsforce.OAuth2({
    loginUrl: "https://login.salesforce.com",
    clientId,
    clientSecret,
    redirectUri,
  });

  const authUrl = oauth2.getAuthorizationUrl({ scope: "api refresh_token offline_access" });
  return NextResponse.redirect(authUrl);
}
