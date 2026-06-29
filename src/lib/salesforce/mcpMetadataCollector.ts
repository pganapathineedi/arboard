import type {
  OrgContext,
  OrgProfile,
  DataVolume,
  CustomObject,
  InstalledPackage,
  AutomationDetail,
  SharingModelDetail,
  LimitsSnapshot,
  ExperienceCloudSite,
  ApexCodeHealth,
  SalesforceTokens,
  DataRisk,
} from "@/lib/types/salesforce";
import { OrgMetadataCollector } from "./OrgMetadataCollector";
import { SalesforceMcpClient } from "./mcpClient";

function dataRisk(count: number): DataRisk {
  if (count >= 5_000_000) return "HIGH RISK";
  if (count >= 1_000_000) return "MEDIUM";
  return "LOW";
}

async function settle<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try { return await promise; } catch { return fallback; }
}

type SfQueryResult<T> = { records: T[]; totalSize: number; done: boolean };

const EMPTY_LIMITS: LimitsSnapshot = {
  dailyApiCallsUsed: 0, dailyApiCallsTotal: 0,
  dataStorageMBUsed: 0, dataStorageMBTotal: 0,
  fileStorageMBUsed: 0, fileStorageMBTotal: 0,
  activeUsers: 0, licensedUsers: 0,
};

const EMPTY_APEX_HEALTH: ApexCodeHealth = {
  totalTriggers: 0, classesBelow75Coverage: 0, asyncQueueDepth: 0,
};

export class McpMetadataCollector {
  private tokens: SalesforceTokens;

  constructor(tokens: SalesforceTokens) {
    this.tokens = tokens;
  }

  async collect(): Promise<OrgContext> {
    try {
      return await this.collectViaMcp();
    } catch (err) {
      console.warn(
        "[mcpMetadataCollector] Falling back to jsforce:",
        err instanceof Error ? err.message : err,
      );
      return new OrgMetadataCollector(this.tokens).collect();
    }
  }

  private async collectViaMcp(): Promise<OrgContext> {
    const client = new SalesforceMcpClient(this.tokens);

    // Connectivity check — throws if MCP is unreachable or tokens are invalid
    const orgResult = await this.soqlQuery<{
      Name: string; OrganizationType: string; IsSandbox: boolean;
    }>(client, "SELECT Name, OrganizationType, IsSandbox FROM Organization LIMIT 1");

    if (!orgResult.records.length) throw new Error("Empty org response from MCP");

    const org = orgResult.records[0];
    const orgProfile: OrgProfile = {
      orgName: org.Name ?? "Unknown",
      edition: org.OrganizationType ?? "Unknown",
      instanceUrl: this.tokens.instanceUrl,
      apiVersion: "62.0",
      isSandbox: org.IsSandbox ?? false,
      featureLicenses: [],
    };

    const [
      dataVolumes,
      customObjects,
      automationDetails,
      apexCodeHealth,
      installedPackages,
      limitsSnapshot,
    ] = await Promise.all([
      settle(this.getDataVolumes(client), [] as DataVolume[]),
      settle(this.getCustomObjects(client), [] as CustomObject[]),
      settle(this.getAutomationInventory(client), [] as AutomationDetail[]),
      settle(this.getApexCodeHealth(client), EMPTY_APEX_HEALTH),
      settle(this.getInstalledPackages(client), [] as InstalledPackage[]),
      settle(this.getLimitsSnapshot(client), EMPTY_LIMITS),
    ]);

    return {
      connectedAt: new Date().toISOString(),
      orgProfile,
      dataVolumes,
      customObjects,
      installedPackages,
      automationDetails,
      sharingModels: [] as SharingModelDetail[],
      limitsSnapshot,
      experienceCloudSites: [] as ExperienceCloudSite[],
      apexCodeHealth,
    };
  }

  private async soqlQuery<T>(
    client: SalesforceMcpClient,
    soql: string,
  ): Promise<SfQueryResult<T>> {
    const result = await client.callTool("sobject-reads", "query", { q: soql });
    const text = SalesforceMcpClient.extractText(result);
    const parsed = JSON.parse(text) as SfQueryResult<T>;
    if (!Array.isArray(parsed.records)) throw new Error("MCP result missing records array");
    return parsed;
  }

  private async getDataVolumes(client: SalesforceMcpClient): Promise<DataVolume[]> {
    const objects = ["Account", "Contact", "Case", "Opportunity", "Lead", "Task", "Event"];
    const results = await Promise.allSettled(
      objects.map(async (obj): Promise<DataVolume> => {
        const res = await this.soqlQuery<Record<string, unknown>>(client, `SELECT COUNT() FROM ${obj}`);
        return { objectName: obj, recordCount: res.totalSize, risk: dataRisk(res.totalSize) };
      }),
    );
    return results
      .filter((r): r is PromiseFulfilledResult<DataVolume> => r.status === "fulfilled")
      .map((r) => r.value);
  }

  private async getCustomObjects(client: SalesforceMcpClient): Promise<CustomObject[]> {
    const res = await this.soqlQuery<{ QualifiedApiName: string; Label: string }>(
      client,
      "SELECT QualifiedApiName, Label FROM EntityDefinition WHERE IsCustomizable = true AND QualifiedApiName LIKE '%__c' LIMIT 50",
    );
    return res.records.map((r) => ({ name: r.QualifiedApiName, label: r.Label }));
  }

  private async getAutomationInventory(client: SalesforceMcpClient): Promise<AutomationDetail[]> {
    const [flowRes, triggerRes] = await Promise.allSettled([
      this.soqlQuery<{ TriggerType: string; ProcessType: string }>(
        client,
        "SELECT TriggerType, ProcessType FROM FlowDefinitionView WHERE Status = 'Active' LIMIT 200",
      ),
      this.soqlQuery<{ TableEnumOrId: string }>(
        client,
        "SELECT TableEnumOrId FROM ApexTrigger WHERE Status = 'Active' LIMIT 200",
      ),
    ]);

    const details: Record<string, AutomationDetail> = {};

    if (flowRes.status === "fulfilled") {
      for (const flow of flowRes.value.records) {
        const obj = flow.TriggerType ?? "Other";
        if (!details[obj]) details[obj] = { objectName: obj, flowCount: 0, triggerCount: 0, hasDeprecatedAutomation: false };
        details[obj].flowCount++;
        if (flow.ProcessType === "Workflow" || flow.ProcessType === "CustomEvent") {
          details[obj].hasDeprecatedAutomation = true;
        }
      }
    }

    if (triggerRes.status === "fulfilled") {
      for (const t of triggerRes.value.records) {
        const obj = t.TableEnumOrId;
        if (!details[obj]) details[obj] = { objectName: obj, flowCount: 0, triggerCount: 0, hasDeprecatedAutomation: false };
        details[obj].triggerCount++;
      }
    }

    return Object.values(details).slice(0, 20);
  }

  private async getApexCodeHealth(client: SalesforceMcpClient): Promise<ApexCodeHealth> {
    const [triggerRes, asyncRes] = await Promise.allSettled([
      this.soqlQuery<{ Id: string }>(client, "SELECT Id FROM ApexTrigger WHERE Status = 'Active'"),
      this.soqlQuery<{ Id: string }>(
        client,
        "SELECT Id FROM AsyncApexJob WHERE Status IN ('Queued', 'Processing', 'Preparing')",
      ),
    ]);
    return {
      totalTriggers: triggerRes.status === "fulfilled" ? triggerRes.value.totalSize : 0,
      classesBelow75Coverage: 0,
      asyncQueueDepth: asyncRes.status === "fulfilled" ? asyncRes.value.totalSize : 0,
    };
  }

  private async getInstalledPackages(client: SalesforceMcpClient): Promise<InstalledPackage[]> {
    // metadata-experts server: try listInstalledPackages tool
    try {
      const result = await client.callTool("metadata-experts", "listInstalledPackages", {});
      const text = SalesforceMcpClient.extractText(result);
      const parsed = JSON.parse(text) as Array<{
        namespace?: string; name?: string; version?: string;
      }>;
      if (Array.isArray(parsed)) {
        return parsed.map((p) => ({
          namespace: p.namespace ?? "",
          name: p.name ?? "",
          version: p.version ?? "",
          publisher: "",
        }));
      }
    } catch { /* metadata-experts not available or tool name differs — skip */ }

    // InstalledSubscriberPackage requires Tooling API, not available via sobject-reads
    return [];
  }

  private async getLimitsSnapshot(client: SalesforceMcpClient): Promise<LimitsSnapshot> {
    try {
      // sobject-reads may expose a dedicated limits tool
      const result = await client.callTool("sobject-reads", "limits", {});
      const text = SalesforceMcpClient.extractText(result);
      const limits = JSON.parse(text) as Record<string, { Max: number; Remaining: number }>;

      const api = limits?.DailyApiRequests;
      const data = limits?.DataStorageMB;
      const file = limits?.FileStorageMB;

      return {
        dailyApiCallsUsed: api?.Max && api?.Remaining != null ? api.Max - api.Remaining : 0,
        dailyApiCallsTotal: api?.Max ?? 0,
        dataStorageMBUsed: data?.Max && data?.Remaining != null ? data.Max - data.Remaining : 0,
        dataStorageMBTotal: data?.Max ?? 0,
        fileStorageMBUsed: file?.Max && file?.Remaining != null ? file.Max - file.Remaining : 0,
        fileStorageMBTotal: file?.Max ?? 0,
        activeUsers: 0,
        licensedUsers: 0,
      };
    } catch {
      return EMPTY_LIMITS;
    }
  }
}
