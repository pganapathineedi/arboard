import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { detectFormat, parseDocument } from "@/lib/documents/DocumentParser";
import { maybeSummarise } from "@/lib/documents/DocumentChunker";
import { extractMetadata } from "@/lib/documents/DocumentMetadata";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { UploadResult, DetectedContext } from "@/lib/types";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(req: NextRequest): Promise<NextResponse> {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds 10 MB limit" }, { status: 413 });
  }

  const format = detectFormat(file.name);
  if (!format) {
    return NextResponse.json(
      { error: "Unsupported file type. Upload a PDF, DOCX, TXT, MD, or HTML file." },
      { status: 415 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const docHash = createHash("sha256").update(buffer).digest("hex");

  let duplicate: { sessionId: string; jiraTicket: string | null } | null = null;
  const supabase = getSupabaseClient();
  if (supabase) {
    const { data } = await supabase
      .from("sessions")
      .select("id, jira_issue_key")
      .eq("doc_hash", docHash)
      .limit(1)
      .maybeSingle();
    if (data) {
      duplicate = { sessionId: data.id as string, jiraTicket: (data.jira_issue_key as string | null) ?? null };
    }
  }

  try {
    const rawText = await parseDocument(buffer, format);
    if (!rawText.trim()) {
      return NextResponse.json({ error: "No readable text found in document" }, { status: 422 });
    }

    const { text: extractedText, wasChunked } = await maybeSummarise(rawText);
    const metadata = extractMetadata(rawText, file.name); // metadata from original text

    const detectedContext: DetectedContext = {
      sessionName: metadata.title,
      clouds:      metadata.sfClouds,
      compliance:  metadata.complianceTerms,
      integrations: metadata.integrations,
    };

    const result: UploadResult = {
      extractedText,
      metadata,
      detectedContext,
      preview: rawText.slice(0, 500),
      wasChunked,
      filename: file.name,
      fileSize: file.size,
      format,
    };

    return NextResponse.json({ ...result, docHash, duplicate });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Extraction failed";
    return NextResponse.json({ error: `Could not process document: ${message}` }, { status: 500 });
  }
}
