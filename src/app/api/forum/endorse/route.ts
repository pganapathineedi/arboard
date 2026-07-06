import { NextRequest, NextResponse } from "next/server";
import { createADRIssue } from "@/lib/integrations/jira";
import { getSupabaseClient } from "@/lib/supabase/client";
import { isMockMode } from "@/lib/mock/mockMode";
import { requireApiKey } from "@/lib/auth/requireApiKey";

export const runtime = "nodejs";

interface EndorseBody {
  sessionId:            string;
  endorsementType:      "countersigned" | "assigned_for_review";
  assigneeAccountId?:   string;
  architectName?:       string;
  architectRole?:       string;
  humanJudgementPoints: string[];
  requirement:          string;
  verdict:              string;
  scribeNotes:          string;
  mustFixIssues:        string[];
  confidenceLevel?:     string;
  revisionRound?:       number;
}

export async function POST(req: NextRequest): Promise<Response> {
  const authError = requireApiKey(req)
  if (authError) return authError
  let body: EndorseBody;
  try {
    body = (await req.json()) as EndorseBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.sessionId || !body.endorsementType) {
    return NextResponse.json({ error: "sessionId and endorsementType are required" }, { status: 400 });
  }

  if (isMockMode()) {
    const fakeKey = `MOCK-${Math.floor(Math.random() * 9000) + 1000}`;
    return NextResponse.json({
      jiraKey: fakeKey,
      jiraUrl: `https://mock.atlassian.net/browse/${fakeKey}`,
    });
  }

  const jiraResult = await createADRIssue({
    requirement:          body.requirement,
    verdict:              body.verdict,
    scribeNotes:          body.scribeNotes,
    mustFixIssues:        body.mustFixIssues,
    sessionId:            body.sessionId,
    confidenceLevel:      body.confidenceLevel,
    humanJudgementPoints: body.humanJudgementPoints,
    assigneeAccountId:    body.assigneeAccountId,
    endorsementType:      body.endorsementType,
    revisionRound:        body.revisionRound,
  }).catch(err => {
    console.error("[endorse] createADRIssue failed:", err);
    return null;
  });

  if (!jiraResult) {
    return NextResponse.json({ error: "Jira ticket creation failed" }, { status: 500 });
  }

  if (body.endorsementType === "countersigned" && body.architectName && body.architectRole) {
    const supabase = getSupabaseClient();
    if (supabase) {
      const timestamp = new Date().toISOString();
      await Promise.all([
        supabase.from("adrs").update({
          countersigned_by:   body.architectName,
          countersigned_role: body.architectRole,
          countersigned_at:   timestamp,
          jira_issue_key:     jiraResult.issueKey,
          jira_issue_url:     jiraResult.issueUrl,
        }).eq("session_id", body.sessionId),
        supabase.from("signoffs").insert({
          session_id:     body.sessionId,
          architect_name: body.architectName,
          architect_role: body.architectRole,
          signed_at:      timestamp,
        }),
        supabase.from("sessions").update({
          jira_issue_key: jiraResult.issueKey,
          jira_issue_url: jiraResult.issueUrl,
          status:         "completed",
        }).eq("id", body.sessionId),
      ]).catch(err => {
        console.warn("[endorse] Supabase update failed (non-fatal):", err);
      });
    }
  }

  return NextResponse.json({
    jiraKey: jiraResult.issueKey,
    jiraUrl: jiraResult.issueUrl,
  });
}
