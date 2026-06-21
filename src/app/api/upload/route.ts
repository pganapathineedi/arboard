import { NextRequest, NextResponse } from "next/server";
import { detectFormat, parseDocument } from "@/lib/documents/DocumentParser";
import { maybeSummarise } from "@/lib/documents/DocumentChunker";
import { extractMetadata } from "@/lib/documents/DocumentMetadata";
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

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Extraction failed";
    return NextResponse.json({ error: `Could not process document: ${message}` }, { status: 500 });
  }
}
