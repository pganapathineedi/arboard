/**
 * Updates the source field on existing failure patterns to match agent ID conventions.
 *
 * FP-004 to FP-012  → source = "sf-patterns"
 * FP-013 to FP-020  → source = "sf-agentforce"
 * PERM-001 to PERM-008 → already correct, skipped
 *
 * Usage: npm run update:fp-sources
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY env vars.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const UPDATES: { ids: string[]; source: string; label: string }[] = [
  {
    ids: ["FP-004", "FP-005", "FP-006", "FP-007", "FP-008", "FP-009", "FP-010", "FP-011", "FP-012"],
    source: "sf-patterns",
    label: "FP-004 to FP-012",
  },
  {
    ids: ["FP-013", "FP-014", "FP-015", "FP-016", "FP-017", "FP-018", "FP-019", "FP-020"],
    source: "sf-agentforce",
    label: "FP-013 to FP-020",
  },
];

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[update-fp-sources] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  let totalUpdated = 0;

  for (const { ids, source, label } of UPDATES) {
    const { error } = await sb
      .from("failure_patterns")
      .update({ source })
      .in("id", ids);

    if (error) {
      console.error(`  Failed to update ${label}: ${error.message}`);
    } else {
      console.log(`  Updated ${label} → source: ${source} (${ids.length} rows)`);
      totalUpdated += ids.length;
    }
  }

  console.log(`\n${totalUpdated} rows updated`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
