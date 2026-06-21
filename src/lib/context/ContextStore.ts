import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { ClientContext, ClientProfile } from "@/lib/types";

const DATA_DIR = join(process.cwd(), "data");
const PROFILES_FILE = join(DATA_DIR, "profiles.json");

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readStore(): Record<string, ClientProfile> {
  ensureDataDir();
  if (!existsSync(PROFILES_FILE)) return {};
  try {
    return JSON.parse(readFileSync(PROFILES_FILE, "utf-8")) as Record<string, ClientProfile>;
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, ClientProfile>): void {
  ensureDataDir();
  writeFileSync(PROFILES_FILE, JSON.stringify(store, null, 2), "utf-8");
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

// In-memory cache to avoid repeated disk reads within a session
const cache = new Map<string, ClientProfile>();

export const ContextStore = {
  save(profile: Omit<ClientProfile, "id" | "createdAt" | "updatedAt">): ClientProfile {
    const store = readStore();
    const id = slugify(profile.clientName);
    const now = new Date().toISOString();
    const existing = store[id];
    const saved: ClientProfile = {
      id,
      clientName: profile.clientName,
      context: profile.context,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    store[id] = saved;
    writeStore(store);
    cache.set(id, saved);
    return saved;
  },

  load(clientNameOrId: string): ClientProfile | null {
    const id = slugify(clientNameOrId);
    if (cache.has(id)) return cache.get(id)!;
    const store = readStore();
    const profile = store[id] ?? null;
    if (profile) cache.set(id, profile);
    return profile;
  },

  list(): ClientProfile[] {
    return Object.values(readStore());
  },

  delete(clientNameOrId: string): void {
    const id = slugify(clientNameOrId);
    const store = readStore();
    delete store[id];
    cache.delete(id);
    writeStore(store);
  },

  // Merge a stored profile's context into an incoming request context.
  // Request context always wins on direct field conflicts; learnings/constraints are unioned.
  merge(stored: ClientContext, request: ClientContext): ClientContext {
    return {
      ...stored,
      ...request,
      existingProducts: Array.from(
        new Set([...(stored.existingProducts ?? []), ...(request.existingProducts ?? [])])
      ),
      constraints: Array.from(
        new Set([...(stored.constraints ?? []), ...(request.constraints ?? [])])
      ),
      learnings: Array.from(
        new Set([...(stored.learnings ?? []), ...(request.learnings ?? [])])
      ),
      metadata: { ...(stored.metadata ?? {}), ...(request.metadata ?? {}) },
    };
  },
};
