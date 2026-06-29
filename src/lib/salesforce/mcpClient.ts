import type { SalesforceTokens } from "@/lib/types/salesforce";

export interface McpToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
}

interface RpcResponse {
  jsonrpc: "2.0";
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

export class SalesforceMcpClient {
  private accessToken: string;
  private refreshToken?: string;
  private instanceUrl: string;
  private orgId?: string;
  private callId = 0;

  private static readonly MCP_ENDPOINTS: Record<string, string> = {
    "sobject-reads": "https://api.salesforce.com/platform/mcp/v1/platform/sobject-reads",
    "metadata-experts": "https://api.salesforce.com/platform/mcp/v1/platform/metadata-experts",
  };

  constructor(tokens: SalesforceTokens) {
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
    this.instanceUrl = tokens.instanceUrl.replace(/\/$/, "");
    this.orgId = tokens.orgId;
  }

  async callTool(
    serverName: string,
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<McpToolResult> {
    try {
      return await this.doCall(serverName, toolName, params);
    } catch (err) {
      if (this.isUnauthorized(err) && this.refreshToken) {
        await this.refreshAccessToken();
        return await this.doCall(serverName, toolName, params);
      }
      throw err;
    }
  }

  private async doCall(
    serverName: string,
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<McpToolResult> {
    const id = String(++this.callId);
    const endpoint = SalesforceMcpClient.MCP_ENDPOINTS[serverName];
    if (!endpoint) throw new Error(`Unknown MCP server: ${serverName}`);

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-03-26",
        "x-sfdc-instance-url": this.instanceUrl,
        ...(this.orgId ? { "x-sfdc-org-id": this.orgId } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name: toolName, arguments: params },
      }),
    });

    if (res.status === 401) throw new Error("UNAUTHORIZED");
    if (!res.ok) throw new Error(`MCP ${serverName}/${toolName}: HTTP ${res.status}`);

    const ct = res.headers.get("content-type") ?? "";
    const rpc: RpcResponse = ct.includes("text/event-stream")
      ? await this.parseSse(res)
      : ((await res.json()) as RpcResponse);

    if (rpc.error) throw new Error(`MCP error: ${rpc.error.message}`);
    return rpc.result as McpToolResult;
  }

  private async parseSse(res: Response): Promise<RpcResponse> {
    const text = await res.text();
    for (const line of text.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data && data !== "[DONE]") {
        try { return JSON.parse(data) as RpcResponse; } catch { continue; }
      }
    }
    throw new Error("Empty SSE response from MCP");
  }

  private isUnauthorized(err: unknown): boolean {
    return err instanceof Error && err.message === "UNAUTHORIZED";
  }

  private async refreshAccessToken(): Promise<void> {
    // Sandbox orgs have "sandbox" or "test" in their instance URL
    const isSandbox =
      this.instanceUrl.includes("sandbox") || this.instanceUrl.includes(".test.");
    const tokenUrl = isSandbox
      ? "https://test.salesforce.com/services/oauth2/token"
      : "https://login.salesforce.com/services/oauth2/token";

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken!,
      client_id: process.env.SF_CLIENT_ID ?? "",
      client_secret: process.env.SF_CLIENT_SECRET ?? "",
    });

    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
    const data = (await res.json()) as { access_token: string };
    this.accessToken = data.access_token;
  }

  static extractText(result: McpToolResult): string {
    return result.content
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text!)
      .join("\n");
  }
}
