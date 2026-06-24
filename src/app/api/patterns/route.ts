import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/lib/supabase/client";

export async function GET(req: NextRequest) {
  const ids = req.nextUrl.searchParams.get("ids")?.split(",").filter(Boolean);
  if (!ids?.length) return NextResponse.json([]);

  const sb = getSupabaseClient();
  if (!sb) return NextResponse.json([]);

  const { data, error } = await sb
    .from("failure_patterns")
    .select("id, title, severity")
    .in("id", ids);

  if (error) return NextResponse.json([]);
  return NextResponse.json(data ?? []);
}
