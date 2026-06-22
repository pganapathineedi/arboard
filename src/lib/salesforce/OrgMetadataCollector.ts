import jsforce, { Connection } from "jsforce";
import type {
  OrgContext, OrgProfile, DataVolume, CustomObject, InstalledPackage,
  AutomationDetail, SharingModelDetail, LimitsSnapshot, ExperienceCloudSite,
  ApexCodeHealth, SalesforceTokens, DataRisk,
} from "@/lib/types/salesforce";

function dataRisk(count: number): DataRisk {
  if (count >= 5_000_000) return "HIGH RISK";
  if (count >= 1_000_000) return "MEDIUM";
  return "LOW";
}

async function settle<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try { return await promise; } catch { return fallback; }
}

export class OrgMetadataCollector {
  private conn: Connection;

  constructor(tokens: SalesforceTokens) {
    this.conn = new jsforce.Connection({
      accessToken: tokens.accessToken,
      instanceUrl: tokens.instanceUrl,
      version: "62.0",
      oauth2: {
        clientId: process.env.SF_CLIENT_ID ?? "",
        clientSecret: process.env.SF_CLIENT_SECRET ?? "",
        redirectUri: process.env.SF_REDIRECT_URI ?? "",
      },
    });
    if (tokens.refreshToken) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.conn as any).refreshToken = tokens.refreshToken;
    }
  }

  async collect(): Promise<OrgContext> {
    const [
      orgProfile,
      dataVolumes,
      customObjects,
      installedPackages,
      automationDetails,
      sharingModels,
      limitsSnapshot,
      experienceCloudSites,
      apexCodeHealth,
    ] = await Promise.all([
      settle(this.getOrgProfile(), { orgName: "Unknown", edition: "Unknown", instanceUrl: this.conn.instanceUrl, apiVersion: "62.0", isSandbox: false, featureLicenses: [] } as OrgProfile),
      settle(this.getDataVolumes(), [] as DataVolume[]),
      settle(this.getCustomObjects(), [] as CustomObject[]),
      settle(this.getInstalledPackages(), [] as InstalledPackage[]),
      settle(this.getAutomationInventory(), [] as AutomationDetail[]),
      settle(this.getSharingModels(), [] as SharingModelDetail[]),
      settle(this.getLimitsSnapshot(), { dailyApiCallsUsed: 0, dailyApiCallsTotal: 0, dataStorageMBUsed: 0, dataStorageMBTotal: 0, fileStorageMBUsed: 0, fileStorageMBTotal: 0, activeUsers: 0, licensedUsers: 0 } as LimitsSnapshot),
      settle(this.getExperienceCloudSites(), [] as ExperienceCloudSite[]),
      settle(this.getApexCodeHealth(), { totalTriggers: 0, classesBelow75Coverage: 0, asyncQueueDepth: 0 } as ApexCodeHealth),
    ]);

    return {
      connectedAt: new Date().toISOString(),
      orgProfile,
      dataVolumes,
      customObjects,
      installedPackages,
      automationDetails,
      sharingModels,
      limitsSnapshot,
      experienceCloudSites,
      apexCodeHealth,
    };
  }

  private async getOrgProfile(): Promise<OrgProfile> {
    const res = await this.conn.query<{ Name: string; OrganizationType: string; IsSandbox: boolean }>(
      "SELECT Name, OrganizationType, IsSandbox FROM Organization LIMIT 1"
    );
    const org = res.records[0];
    return {
      orgName: org?.Name ?? "Unknown",
      edition: org?.OrganizationType ?? "Unknown",
      instanceUrl: this.conn.instanceUrl,
      apiVersion: "62.0",
      isSandbox: org?.IsSandbox ?? false,
      featureLicenses: [],
    };
  }

  private async getDataVolumes(): Promise<DataVolume[]> {
    const objects = ["Account", "Contact", "Case", "Opportunity", "Lead", "Task", "Event"];
    const results = await Promise.allSettled(
      objects.map(async (obj): Promise<DataVolume> => {
        const res = await this.conn.query<{ Id: string }>(`SELECT COUNT() FROM ${obj}`);
        return { objectName: obj, recordCount: res.totalSize, risk: dataRisk(res.totalSize) };
      })
    );
    return results
      .filter((r): r is PromiseFulfilledResult<DataVolume> => r.status === "fulfilled")
      .map(r => r.value);
  }

  private async getCustomObjects(): Promise<CustomObject[]> {
    const res = await this.conn.query<{ QualifiedApiName: string; Label: string }>(
      "SELECT QualifiedApiName, Label FROM EntityDefinition WHERE IsCustomizable = true AND QualifiedApiName LIKE '%__c' LIMIT 50"
    );
    return (res.records ?? []).map((r: { QualifiedApiName: string; Label: string }) => ({ name: r.QualifiedApiName, label: r.Label }));
  }

  private async getInstalledPackages(): Promise<InstalledPackage[]> {
    type PkgRecord = {
      SubscriberPackage: { Name: string; NamespacePrefix: string };
      SubscriberPackageVersion: { VersionNumber: string };
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (this.conn.tooling as any).query(
      "SELECT SubscriberPackage.Name, SubscriberPackage.NamespacePrefix, SubscriberPackageVersion.VersionNumber FROM InstalledSubscriberPackage"
    ) as { records: PkgRecord[] };
    return (res.records ?? []).map((r: PkgRecord) => ({
      namespace: r.SubscriberPackage?.NamespacePrefix ?? "",
      name: r.SubscriberPackage?.Name ?? "",
      version: r.SubscriberPackageVersion?.VersionNumber ?? "",
      publisher: "",
    }));
  }

  private async getAutomationInventory(): Promise<AutomationDetail[]> {
    const [flowRes, triggerRes] = await Promise.allSettled([
      this.conn.query<{ TriggerType: string; ProcessType: string }>(
        "SELECT TriggerType, ProcessType FROM FlowDefinitionView WHERE Status = 'Active' LIMIT 200"
      ),
      this.conn.query<{ TableEnumOrId: string }>(
        "SELECT TableEnumOrId FROM ApexTrigger WHERE Status = 'Active' LIMIT 200"
      ),
    ]);

    const details: Record<string, AutomationDetail> = {};

    if (flowRes.status === "fulfilled") {
      for (const flow of flowRes.value.records ?? []) {
        const obj = flow.TriggerType ?? "Other";
        if (!details[obj]) details[obj] = { objectName: obj, flowCount: 0, triggerCount: 0, hasDeprecatedAutomation: false };
        details[obj].flowCount++;
        if (flow.ProcessType === "Workflow" || flow.ProcessType === "CustomEvent") {
          details[obj].hasDeprecatedAutomation = true;
        }
      }
    }

    if (triggerRes.status === "fulfilled") {
      for (const t of triggerRes.value.records ?? []) {
        const obj = t.TableEnumOrId;
        if (!details[obj]) details[obj] = { objectName: obj, flowCount: 0, triggerCount: 0, hasDeprecatedAutomation: false };
        details[obj].triggerCount++;
      }
    }

    return Object.values(details).slice(0, 20);
  }

  private async getSharingModels(): Promise<SharingModelDetail[]> {
    const res = await this.conn.query<{ QualifiedApiName: string; SharingModel: string }>(
      "SELECT QualifiedApiName, SharingModel FROM EntityDefinition WHERE IsApexTriggerable = true AND IsCustomizable = true LIMIT 20"
    );
    return (res.records ?? []).map((r: { QualifiedApiName: string; SharingModel: string }) => ({
      objectName: r.QualifiedApiName,
      owd: r.SharingModel ?? "Unknown",
      sharingRulesCount: 0,
      hasApexSharing: false,
    }));
  }

  private async getLimitsSnapshot(): Promise<LimitsSnapshot> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const limits = await this.conn.limits() as any;
    const api = limits?.DailyApiRequests;
    const data = limits?.DataStorageMB;
    const file = limits?.FileStorageMB;
    return {
      dailyApiCallsUsed: api?.Max && api?.Remaining ? api.Max - api.Remaining : 0,
      dailyApiCallsTotal: api?.Max ?? 0,
      dataStorageMBUsed: data?.Max && data?.Remaining ? data.Max - data.Remaining : 0,
      dataStorageMBTotal: data?.Max ?? 0,
      fileStorageMBUsed: file?.Max && file?.Remaining ? file.Max - file.Remaining : 0,
      fileStorageMBTotal: file?.Max ?? 0,
      activeUsers: 0,
      licensedUsers: 0,
    };
  }

  private async getExperienceCloudSites(): Promise<ExperienceCloudSite[]> {
    const res = await this.conn.query<{ Name: string; Status: string; Template: string }>(
      "SELECT Name, Status, Template FROM Network LIMIT 10"
    );
    return (res.records ?? []).map((r: { Name: string; Status: string; Template: string }) => ({
      name: r.Name,
      templateType: r.Template ?? "Unknown",
      status: r.Status ?? "Unknown",
    }));
  }

  private async getApexCodeHealth(): Promise<ApexCodeHealth> {
    const [triggerRes, asyncRes] = await Promise.allSettled([
      this.conn.query<{ Id: string }>("SELECT Id FROM ApexTrigger WHERE Status = 'Active'"),
      this.conn.query<{ Id: string }>("SELECT Id FROM AsyncApexJob WHERE Status IN ('Queued', 'Processing', 'Preparing')"),
    ]);

    return {
      totalTriggers: triggerRes.status === "fulfilled" ? triggerRes.value.totalSize : 0,
      classesBelow75Coverage: 0,
      asyncQueueDepth: asyncRes.status === "fulfilled" ? asyncRes.value.totalSize : 0,
    };
  }
}
