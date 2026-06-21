import mammoth from "mammoth";
import { load as cheerioLoad } from "cheerio";

export type DocFormat = "pdf" | "docx" | "txt" | "md" | "html";

export function detectFormat(filename: string): DocFormat | null {
  const n = filename.toLowerCase();
  if (n.endsWith(".pdf"))  return "pdf";
  if (n.endsWith(".docx")) return "docx";
  if (n.endsWith(".txt"))  return "txt";
  if (n.endsWith(".md"))   return "md";
  if (n.endsWith(".html") || n.endsWith(".htm")) return "html";
  return null;
}

export async function parseDocument(buffer: Buffer, format: DocFormat): Promise<string> {
  switch (format) {
    case "pdf": {
      // Dynamic require avoids pdf-parse side-effects that break Next.js static analysis
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string }>;
      const result = await pdfParse(buffer);
      return result.text;
    }
    case "docx": {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    }
    case "txt":
    case "md":
      return buffer.toString("utf-8");
    case "html": {
      const $ = cheerioLoad(buffer.toString("utf-8"));
      $("script, style, nav, header, footer, aside, [role='navigation'], [role='banner']").remove();
      // Confluence exports often put content in #main-content or .wiki-content
      const main = $("#main-content, .wiki-content, .page-content, article, main").first();
      const text = (main.length ? main : $("body")).text();
      return text.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    }
  }
}
