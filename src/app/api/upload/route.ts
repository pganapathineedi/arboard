import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { requireApiKey } from "@/lib/auth/requireApiKey";
import { detectFormat, parseDocument } from "@/lib/documents/DocumentParser";
import { maybeSummarise } from "@/lib/documents/DocumentChunker";
import { extractMetadata } from "@/lib/documents/DocumentMetadata";
import { getSupabaseClient } from "@/lib/supabase/client";
import type { UploadResult, DetectedContext } from "@/lib/types";

const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_IMAGES = 5;

type EmbeddedImage = { name: string; mediaType: "image/png" | "image/jpeg"; base64: string };

async function extractDocxImages(buffer: Buffer): Promise<EmbeddedImage[]> {
  const images: EmbeddedImage[] = [];
  try {
    const zip = await JSZip.loadAsync(buffer);
    for (const [path, file] of Object.entries(zip.files)) {
      if (images.length >= MAX_IMAGES) break;
      if (!/^word\/media\//i.test(path)) continue;
      const lower = path.toLowerCase();
      const mediaType = lower.endsWith(".png")
        ? "image/png"
        : lower.endsWith(".jpg") || lower.endsWith(".jpeg")
        ? "image/jpeg"
        : null;
      if (!mediaType) continue;
      const data = await file.async("nodebuffer");
      if (data.length > MAX_IMAGE_BYTES) continue;
      images.push({ name: path.split("/").pop()!, mediaType, base64: data.toString("base64") });
    }
  } catch {
    // malformed zip — return what we have
  }
  return images;
}

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authError = requireApiKey(req)
  if (authError) return authError
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

    const embeddedImages: EmbeddedImage[] = format === "docx" ? await extractDocxImages(buffer) : [];
    console.log(`[upload] embeddedImages extracted: ${embeddedImages.length}`);

    return NextResponse.json({ ...result, docHash, duplicate, embeddedImages });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Extraction failed";
    return NextResponse.json({ error: `Could not process document: ${message}` }, { status: 500 });
  }
}
