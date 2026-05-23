import fs from "node:fs/promises";
import path from "node:path";

import cors from "cors";
import express from "express";
import multer from "multer";

import { config, DATA_DIR, FRONTEND_DIST_DIR, UPLOADS_DIR } from "./config.js";
import { signToken, authMiddleware } from "./lib/auth.js";
import { createUser, findUserByEmail, sanitizeUser, verifyUser } from "./lib/users.js";
import {
  listUploadedPdfs,
  deleteUploadedPdf,
  extractDocumentsFromPdfs,
  buildContext
} from "./lib/pdf.js";
import { generateQuizBundle } from "./lib/hf.js";
import { buildQuizPdf } from "./lib/export-pdf.js";

await fs.mkdir(DATA_DIR, { recursive: true });
await fs.mkdir(UPLOADS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, UPLOADS_DIR),
    filename: (_req, file, callback) => callback(null, file.originalname)
  })
});

const app = express();

app.use(
  cors({
    origin: config.frontendUrl,
    credentials: false
  })
);
app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email, and password are required." });
    }

    const existing = await findUserByEmail(email);
    if (existing) {
      return res.status(409).json({ message: "User already exists." });
    }

    const user = await createUser({ name, email, password });
    const token = signToken(user);
    return res.status(201).json({ token, user });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const user = await verifyUser(req.body.email, req.body.password);
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials." });
    }
    return res.json({ token: signToken(user), user });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.post("/api/auth/logout", (_req, res) => {
  res.json({ success: true });
});

app.get("/api/auth/me", authMiddleware, async (req, res) => {
  const user = await findUserByEmail(req.user.email);
  res.json({ user: sanitizeUser(user) });
});

app.get("/api/pdfs", authMiddleware, async (_req, res) => {
  try {
    res.json({ pdfs: await listUploadedPdfs() });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/pdfs/upload", authMiddleware, upload.array("files"), async (_req, res) => {
  try {
    res.status(201).json({ pdfs: await listUploadedPdfs() });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.delete("/api/pdfs/:name", authMiddleware, async (req, res) => {
  try {
    await deleteUploadedPdf(req.params.name);
    res.json({ pdfs: await listUploadedPdfs() });
  } catch (error) {
    const status =
      error.message === "Invalid PDF name."
        ? 400
        : error.message === "PDF not found."
          ? 404
          : 500;
    res.status(status).json({ message: error.message });
  }
});

app.post("/api/quiz/generate", authMiddleware, async (req, res) => {
  try {
    const { pdfNames, examStyle, questionCount, customPrompt = "" } = req.body;
    if (!Array.isArray(pdfNames) || !pdfNames.length) {
      return res.status(400).json({ message: "Select at least one PDF." });
    }

    const documents = await extractDocumentsFromPdfs(pdfNames);
    const context = buildContext(documents, Number(questionCount || 5));
    const quiz = await generateQuizBundle({
      context,
      questionCount: Number(questionCount || 5),
      examStyle: examStyle || "BPSC",
      customPrompt
    });

    res.json(quiz);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/quiz/export", authMiddleware, async (req, res) => {
  try {
    const pdfBuffer = await buildQuizPdf({
      examStyle: req.body.examStyle || "Practice",
      summary: req.body.summary || "",
      questions: Array.isArray(req.body.questions) ? req.body.questions : []
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${(req.body.examStyle || "practice").toLowerCase()}_mcqs.pdf"`
    );
    res.send(pdfBuffer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.use("/api", (_req, res) => {
  res.status(404).json({ message: "API route not found." });
});

app.use(express.static(FRONTEND_DIST_DIR));

app.get("*", async (_req, res, next) => {
  const indexPath = path.join(FRONTEND_DIST_DIR, "index.html");
  try {
    await fs.access(indexPath);
    res.sendFile(indexPath);
  } catch (error) {
    next(error);
  }
});

app.listen(config.port, () => {
  console.log(`Backend running on http://localhost:${config.port}`);
});
