import type { OrgContext } from "@/lib/types/salesforce";

export function formatOrgContextForAgents(ctx: OrgContext): string {
  const {
    orgProfile,
    automationDetails,
    customObjects,
    dataVolumes,
    limitsSnapshot,
    apexCodeHealth,
    installedPackages,
    connectedAt,
  } = ctx;

  const lines: string[] = [];

  lines.push(
    `**Organisation:** ${orgProfile.orgName} | ${orgProfile.edition}${orgProfile.isSandbox ? " (Sandbox)" : " (Production)"} | API v${orgProfile.apiVersion}`,
  );

  // Automation inventory with FP-007 flag for multiple triggers on same object
  const automatedObjects = automationDetails.filter(
    (a) => a.triggerCount > 0 || a.flowCount > 0 || a.hasDeprecatedAutomation,
  );
  if (automatedObjects.length > 0) {
    lines.push("\n**Automation Inventory:**");
    for (const a of automatedObjects) {
      const parts: string[] = [];
      if (a.triggerCount === 1) parts.push("1 Apex trigger");
      if (a.triggerCount > 1) {
        parts.push(`${a.triggerCount} Apex triggers ⚠ FP-007 (multiple triggers — must consolidate into handler framework)`);
      }
      if (a.flowCount > 0) parts.push(`${a.flowCount} active Flow${a.flowCount > 1 ? "s" : ""}`);
      if (a.hasDeprecatedAutomation) {
        parts.push("deprecated automation (Workflow Rule / Process Builder) — MUST MIGRATE");
      }
      if (parts.length > 0) lines.push(`- ${a.objectName}: ${parts.join(", ")}`);
    }
  }

  const deprecatedObjectCount = automationDetails.filter((a) => a.hasDeprecatedAutomation).length;
  if (deprecatedObjectCount > 0) {
    lines.push(`**Deprecated Automation Warning:** ${deprecatedObjectCount} object(s) with Workflow Rules or Process Builder — migration to Flow is required`);
  }

  // Custom objects
  if (customObjects.length > 0) {
    const sample = customObjects
      .slice(0, 4)
      .map((o) => o.name)
      .join(", ");
    const more = customObjects.length > 4 ? " ..." : "";
    lines.push(`\n**Custom Objects:** ${customObjects.length} total (e.g. ${sample}${more})`);
  }

  // Org limits
  const {
    dailyApiCallsUsed,
    dailyApiCallsTotal,
    dataStorageMBUsed,
    dataStorageMBTotal,
    fileStorageMBUsed,
    fileStorageMBTotal,
  } = limitsSnapshot;

  if (dailyApiCallsTotal > 0 || dataStorageMBTotal > 0) {
    lines.push("\n**Org Limits:**");
    if (dailyApiCallsTotal > 0) {
      const pct = Math.round((dailyApiCallsUsed / dailyApiCallsTotal) * 100);
      const flag = pct >= 80 ? " ⚠ HIGH USAGE — consider Platform Events or Bulk API" : "";
      lines.push(
        `- Daily API calls: ${dailyApiCallsUsed.toLocaleString()} / ${dailyApiCallsTotal.toLocaleString()} (${pct}%)${flag}`,
      );
    }
    if (dataStorageMBTotal > 0) {
      const pct = Math.round((dataStorageMBUsed / dataStorageMBTotal) * 100);
      const flag = pct >= 85 ? " ⚠ NEAR CAPACITY" : "";
      lines.push(
        `- Data storage: ${(dataStorageMBUsed / 1024).toFixed(1)} GB / ${(dataStorageMBTotal / 1024).toFixed(1)} GB (${pct}%)${flag}`,
      );
    }
    if (fileStorageMBTotal > 0) {
      lines.push(
        `- File storage: ${(fileStorageMBUsed / 1024).toFixed(1)} GB / ${(fileStorageMBTotal / 1024).toFixed(1)} GB`,
      );
    }
  }

  // Async queue depth
  if (apexCodeHealth.asyncQueueDepth > 0) {
    const flag =
      apexCodeHealth.asyncQueueDepth >= 10
        ? " ⚠ ELEVATED — risk of async governor contention"
        : "";
    lines.push(`\n**Async Apex Queue:** ${apexCodeHealth.asyncQueueDepth} jobs active (Queued/Processing/Preparing)${flag}`);
  }

  // Data volumes — show non-LOW risk objects, or top 3 if all LOW
  const riskyVolumes = dataVolumes.filter((d) => d.risk !== "LOW");
  const volumesToShow = riskyVolumes.length > 0 ? riskyVolumes : dataVolumes.slice(0, 3);
  if (volumesToShow.length > 0) {
    lines.push("\n**Key Data Volumes:**");
    for (const dv of volumesToShow) {
      const flag = dv.risk !== "LOW" ? ` ← ${dv.risk}` : "";
      lines.push(`- ${dv.objectName}: ${dv.recordCount.toLocaleString()} records${flag}`);
    }
  }

  // Installed packages
  if (installedPackages.length > 0) {
    const pkgList = installedPackages
      .map(
        (p) =>
          `${p.name}${p.namespace ? ` (${p.namespace})` : ""}${p.version ? ` v${p.version}` : ""}`,
      )
      .join(", ");
    lines.push(`\n**Installed Packages:** ${pkgList}`);
  }

  lines.push(`\n*Live org data fetched: ${new Date(connectedAt).toUTCString()}*`);

  return lines.join("\n");
}
