import fs from "node:fs/promises";
import path from "node:path";
import pdfParse from "pdf-parse";

import { UPLOADS_DIR } from "../config.js";

function splitText(text, chunkSize = 1000, chunkOverlap = 120) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];

  const chunks = [];
  const step = Math.max(1, chunkSize - chunkOverlap);
  for (let start = 0; start < cleaned.length; start += step) {
    chunks.push(cleaned.slice(start, start + chunkSize));
  }
  return chunks;
}

function tokenize(text) {
  return new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) || []);
}

export async function listUploadedPdfs() {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  const entries = await fs.readdir(UPLOADS_DIR, { withFileTypes: true });
  const pdfs = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".pdf")) continue;
    const fullPath = path.join(UPLOADS_DIR, entry.name);
    const stats = await fs.stat(fullPath);
    pdfs.push({
      name: entry.name,
      size: stats.size,
      uploadedAt: stats.mtime.toISOString()
    });
  }

  return pdfs.sort((a, b) => a.name.localeCompare(b.name));
}

export async function deleteUploadedPdf(fileName) {
  const normalizedName = path.basename(fileName || "");
  if (
    !normalizedName ||
    normalizedName !== fileName ||
    !normalizedName.toLowerCase().endsWith(".pdf")
  ) {
    throw new Error("Invalid PDF name.");
  }

  const filePath = path.join(UPLOADS_DIR, normalizedName);

  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error("PDF not found.");
    }
    throw error;
  }
}

export async function extractDocumentsFromPdfs(fileNames) {
  const documents = [];

  for (const fileName of fileNames) {
    const filePath = path.join(UPLOADS_DIR, fileName);
    const buffer = await fs.readFile(filePath);
    const parsed = await pdfParse(buffer);
    const chunks = splitText(parsed.text || "");

    chunks.forEach((chunk, index) => {
      documents.push({
        pageContent: chunk,
        metadata: {
          source: fileName,
          chunk: index + 1
        }
      });
    });
  }

  if (!documents.length) {
    throw new Error("No readable PDF content found in selected files.");
  }

  return documents;
}

export function buildContext(documents, questionCount) {
  const queryTerms = tokenize(
    `Generate exactly ${questionCount} multiple choice questions from the provided study material`
  );

  const selected = documents
    .map((document) => {
      const documentTerms = tokenize(document.pageContent);
      const overlap = [...queryTerms].filter((term) => documentTerms.has(term)).length;
      const score = overlap + Math.min(document.pageContent.length / 1000, 1);
      return { score, document };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.min(12, Math.max(6, questionCount * 2)))
    .map(({ document }) => document);

  return selected
    .map(
      (document) =>
        `Source: ${document.metadata.source}\nContent: ${document.pageContent}`
    )
    .join("\n");
}
