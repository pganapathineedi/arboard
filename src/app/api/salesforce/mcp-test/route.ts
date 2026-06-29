import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import type { SessionData } from "@/lib/session";
import { sessionOptions } from "@/lib/session";

export const runtime = "nodejs";
export const maxDuration = 60;

const BASE = "https://api.salesforce.com/platform/mcp/v1/platform/sobject-reads";
const RPC_BODY = JSON.stringify({ jsonrpc: "2.0", id: "1", method: "tools/list", params: {} });

async function callMcp(label: string, token: string, extraHeaders: Record<string, string> = {}) {
  try {
    const res = await fetch(BASE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-03-26",
        ...extraHeaders,
      },
      body: RPC_BODY,
    });
    const text = await res.text();
    return { label, status: res.status, body: text.slice(0, 800) };
  } catch (err) {
    return { label, status: -1, body: err instanceof Error ? err.message : String(err) };
  }
}

export async function GET(): Promise<Response> {
  const session = await getIronSession<SessionData>(cookies(), sessionOptions);
  if (!session.salesforce?.accessToken) {
    return NextResponse.json({ error: "Not connected to Salesforce" }, { status: 401 });
  }

  const { accessToken, instanceUrl, orgId } = session.salesforce;
  const clientId = process.env.SF_CLIENT_ID ?? "";
  const clientSecret = process.env.SF_CLIENT_SECRET ?? "";
  const base = instanceUrl.replace(/\/$/, "");

  // Get CC token with new client ID
  interface CcResponse { access_token?: string; scope?: string; api_instance_url?: string; error?: string; error_description?: string; }
  const ccRes = await fetch(`${base}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }).toString(),
  });
  const ccData = await ccRes.json() as CcResponse;
  const ccToken = ccData.access_token ?? null;

  const results = await Promise.all([
    callMcp("user-oauth-token", accessToken, { "x-sfdc-instance-url": instanceUrl, ...(orgId ? { "x-sfdc-org-id": orgId } : {}) }),
    ccToken
      ? callMcp("cc-token", ccToken)
      : Promise.resolve({ label: "cc-token", status: -1, body: `CC failed: ${JSON.stringify(ccData)}` }),
    ccToken
      ? callMcp("cc-token + sfdc-headers", ccToken, { "x-sfdc-instance-url": instanceUrl, ...(orgId ? { "x-sfdc-org-id": orgId } : {}) })
      : Promise.resolve({ label: "cc-token+headers", status: -1, body: "no CC token" }),
  ]);

  // Introspect user token to see if mcp_api scope is now present
  let userScope = "unknown";
  try {
    const iRes = await fetch("https://login.salesforce.com/services/oauth2/introspect", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: accessToken, client_id: clientId, client_secret: clientSecret, token_type_hint: "access_token" }).toString(),
    });
    const iData = await iRes.json() as { scope?: string };
    userScope = iData.scope ?? "unknown";
  } catch { /* non-fatal */ }

  return NextResponse.json({
    userScope,
    ccScope: ccData.scope,
    ccApiInstanceUrl: ccData.api_instance_url,
    ccError: ccData.error,
    results,
  });
}
