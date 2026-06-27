import { NextResponse } from "next/server";
import { fetchProjectMembers } from "@/lib/integrations/jira";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const members = await fetchProjectMembers();
    return NextResponse.json(members);
  } catch {
    return NextResponse.json([]);
  }
}
