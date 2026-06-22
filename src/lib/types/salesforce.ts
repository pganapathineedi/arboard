// ─── Salesforce Org Types ─────────────────────────────────────────────────────

export type DataRisk = "HIGH RISK" | "MEDIUM" | "LOW";

export interface OrgProfile {
  orgName: string;
  edition: string;
  instanceUrl: string;
  apiVersion: string;
  isSandbox: boolean;
  featureLicenses: string[];
}

export interface DataVolume {
  objectName: string;
  recordCount: number;
  risk: DataRisk;
}

export interface CustomObject {
  name: string;
  label: string;
  recordCount?: number;
}

export interface InstalledPackage {
  namespace: string;
  name: string;
  version: string;
  publisher: string;
}

export interface AutomationDetail {
  objectName: string;
  flowCount: number;
  triggerCount: number;
  hasDeprecatedAutomation: boolean;
}

export interface SharingModelDetail {
  objectName: string;
  owd: string;
  sharingRulesCount: number;
  hasApexSharing: boolean;
}

export interface LimitsSnapshot {
  dailyApiCallsUsed: number;
  dailyApiCallsTotal: number;
  dataStorageMBUsed: number;
  dataStorageMBTotal: number;
  fileStorageMBUsed: number;
  fileStorageMBTotal: number;
  activeUsers: number;
  licensedUsers: number;
}

export interface ExperienceCloudSite {
  name: string;
  templateType: string;
  status: string;
}

export interface ApexCodeHealth {
  totalTriggers: number;
  classesBelow75Coverage: number;
  asyncQueueDepth: number;
}

export interface OrgContext {
  connectedAt: string;
  orgProfile: OrgProfile;
  dataVolumes: DataVolume[];
  customObjects: CustomObject[];
  installedPackages: InstalledPackage[];
  automationDetails: AutomationDetail[];
  sharingModels: SharingModelDetail[];
  limitsSnapshot: LimitsSnapshot;
  experienceCloudSites: ExperienceCloudSite[];
  apexCodeHealth: ApexCodeHealth;
}

export interface SalesforceTokens {
  accessToken: string;
  refreshToken?: string;
  instanceUrl: string;
  orgId?: string;
  orgName?: string;
  edition?: string;
  isSandbox?: boolean;
  connectedAt?: string;
}
