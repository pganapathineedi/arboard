/**
 * Seed PERM-001 to PERM-008 failure patterns into failure_patterns and grounding_embeddings.
 * Run: npm run seed:perm-patterns
 * Requires: VOYAGE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY env vars.
 */

import { createClient } from "@supabase/supabase-js";

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_DELAY_MS = 100;

const permFailurePatterns = [
  {
    id: "PERM-001",
    title: "Profile-centric design anti-pattern",
    scenario:
      "Profiles are used to manage all object and FLS permissions rather than permission sets. Design shows more than 5 profiles or profiles carrying object-level CRUD permissions beyond baseline app/tab visibility.",
    better_path:
      "Use profiles for baseline only (login hours, page layouts, record types, app visibility). Move all object CRUD and FLS to permission sets, bundled into permission set groups (PSGs) per role. Assign PSGs to users, not individual permission sets.",
    severity: "medium",
    components: ["Profiles", "PermissionSets"],
    tags: ["access-model", "scalability", "profiles-permissions"],
    source: "sf-profiles-permissions",
  },
  {
    id: "PERM-002",
    title: "Missing FLS specification on sensitive fields",
    scenario:
      "SDD describes data model changes or new custom fields (PII, financial, health data) without explicitly stating which profiles or permission sets get Read, Edit, or None on those fields.",
    better_path:
      "For every custom field containing PII, financial, or health data, explicitly document FLS per profile/permission set in the SDD. Include a field security matrix. For regulated industries (financial services, health, public sector), treat missing FLS specification as a compliance gap.",
    severity: "high",
    components: ["PermissionSets", "Profiles", "DataModel"],
    tags: ["FLS", "PII", "compliance", "profiles-permissions"],
    source: "sf-profiles-permissions",
  },
  {
    id: "PERM-003",
    title: "OWD and sharing model misalignment",
    scenario:
      "OWD is set to Private or Public Read Only for key objects but no sharing rules, role hierarchy, or Apex Sharing are documented. Alternatively, OWD is set to Public Read/Write for objects that contain sensitive or restricted data.",
    better_path:
      "For every object with Private or Public Read Only OWD, document the complete sharing model: sharing rules (criteria-based or ownership-based), role hierarchy levels, and any Apex Sharing triggers. OWD is the floor — everything above it must be explicitly designed, not left to runtime defaults.",
    severity: "high",
    components: ["SharingModel", "Profiles"],
    tags: ["OWD", "sharing", "role-hierarchy", "profiles-permissions"],
    source: "sf-profiles-permissions",
  },
  {
    id: "PERM-004",
    title: "Guest user over-permissioning",
    scenario:
      "Guest user profile in an Experience Cloud / Community implementation has Create, Edit, or Delete permissions on any object, or has Read access to objects containing internal-only data (e.g. internal Accounts, financial records, staff contacts).",
    better_path:
      "Guest user profile should have Read only on explicitly required objects — nothing else. Enforce FLS Read only on non-sensitive fields; no PII access. Define guest user sharing rules explicitly. Any Apex accessible without login must be reviewed for data leakage. API Enabled permission must be off for guest sessions.",
    severity: "critical",
    components: ["GuestUser", "ExperienceCloud", "Profiles"],
    tags: ["guest-user", "experience-cloud", "security", "profiles-permissions"],
    source: "sf-profiles-permissions",
  },
  {
    id: "PERM-005",
    title: "Internal and external user boundary gap",
    scenario:
      "External users (Community or Experience Cloud) can traverse object relationships to reach internal-only records — for example, a Community user with access to a Contact can navigate to the related Account and access internal financial data not intended for external visibility.",
    better_path:
      "Explicitly design the data boundary between internal and external users. Set OWD for all objects accessible to external users. Use sharing sets and sharing groups to control exactly what external users can see. Test relationship traversal paths — every parent-child and lookup relationship that an external user can reach must be reviewed.",
    severity: "critical",
    components: ["ExperienceCloud", "SharingModel", "Profiles"],
    tags: ["external-users", "data-boundary", "experience-cloud", "profiles-permissions"],
    source: "sf-profiles-permissions",
  },
  {
    id: "PERM-006",
    title: "Missing permission set group architecture",
    scenario:
      "Design assigns individual permission sets directly to users rather than using permission set groups (PSGs). At scale this creates an unmanageable permission model where a single user may have 10+ individual PSs assigned, making access audits and role-based reviews impractical.",
    better_path:
      "Define PSGs per role: [Role]-Base (core object access), [Role]-Extended (reports, dashboards, exports), [Role]-Integration (API access, assigned to integration users only). Users get PSGs. Use muting permission sets within a PSG where a sub-group needs fewer permissions than the PSG baseline.",
    severity: "medium",
    components: ["PermissionSets", "PermissionSetGroups"],
    tags: ["PSG", "scalability", "auditability", "profiles-permissions"],
    source: "sf-profiles-permissions",
  },
  {
    id: "PERM-007",
    title: "System permission sprawl",
    scenario:
      "Profiles or permission sets grant View All Data, Modify All Data, Manage Users, or API Enabled to user populations that do not operationally require those permissions. Commonly seen when a standard Salesforce Administrator profile is cloned and used as a base for non-admin roles.",
    better_path:
      "Apply least privilege. View All / Modify All should be restricted to System Administrator profile only. API Enabled should be granted only to integration users and developer profiles. Manage Users only to HR/admin roles. Audit all system permissions in each profile and PS — any that cannot be justified by a specific operational need should be removed.",
    severity: "high",
    components: ["Profiles", "PermissionSets", "SystemPermissions"],
    tags: ["least-privilege", "system-permissions", "security", "profiles-permissions"],
    source: "sf-profiles-permissions",
  },
  {
    id: "PERM-008",
    title: "Named credential and connected app scope gap",
    scenario:
      "Integration users or connected apps are granted broader OAuth scopes than operationally required (e.g. full access scope instead of specific API scopes), or integration users are assigned the System Administrator profile instead of a dedicated integration profile with minimal permissions.",
    better_path:
      "Define a dedicated integration profile per integration pattern with only the minimum required object permissions, FLS, and system permissions. Use named credentials to isolate authentication. Scope OAuth to the minimum required API surface. Never assign System Administrator to an integration user — create a custom profile with only the permissions the integration needs.",
    severity: "high",
    components: ["Integration", "NamedCredentials", "ConnectedApps", "Profiles"],
    tags: ["integration", "named-credentials", "oauth", "least-privilege", "profiles-permissions"],
    source: "sf-profiles-permissions",
  },
];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function embedText(text: string): Promise<number[]> {
  if (!VOYAGE_API_KEY) throw new Error("VOYAGE_API_KEY env var is required");

  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: [text], model: "voyage-code-3", input_type: "document" }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Voyage API ${res.status}: ${body}`);
  }

  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data[0].embedding;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[seed-perm-patterns] Supabase unavailable — missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  if (!VOYAGE_API_KEY) {
    console.error("[seed-perm-patterns] Missing VOYAGE_API_KEY");
    process.exit(1);
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Step 1: upsert into failure_patterns
  let patternCount = 0;
  for (const pattern of permFailurePatterns) {
    const { error } = await sb
      .from("failure_patterns")
      .upsert(pattern, { onConflict: "id" });

    if (error) {
      console.error(`  [failure_patterns] Failed to upsert ${pattern.id}: ${error.message}`);
    } else {
      console.log(`  [failure_patterns] Upserted ${pattern.id}`);
      patternCount++;
    }
  }

  // Step 2: embed and upsert into grounding_embeddings
  let embeddingCount = 0;
  for (const pattern of permFailurePatterns) {
    const combinedText = `${pattern.title}\n\n${pattern.scenario}\n\n${pattern.better_path}`;

    console.log(`  [grounding_embeddings] Embedding ${pattern.id}…`);
    const embedding = await embedText(combinedText);

    const { error } = await sb.from("grounding_embeddings").upsert(
      {
        source_id: pattern.id,
        content_type: "failure_pattern",
        chunk_text: combinedText,
        metadata: {
          domain: "salesforce",
          chunk_index: 0,
          agent_hints: ["sf-profiles-permissions"],
          tags: pattern.tags,
        },
        embedding,
      },
      { onConflict: "source_id" }
    );

    if (error) {
      console.error(`  [grounding_embeddings] Failed to upsert ${pattern.id}: ${error.message}`);
    } else {
      console.log(`  [grounding_embeddings] Upserted ${pattern.id}`);
      embeddingCount++;
    }

    await delay(VOYAGE_DELAY_MS);
  }

  console.log(
    `\nSeeded ${patternCount} failure patterns to failure_patterns, ${embeddingCount} embeddings to grounding_embeddings`
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
