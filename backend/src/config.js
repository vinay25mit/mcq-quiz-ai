import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = path.resolve(__dirname, "..");
export const PROJECT_ROOT = path.resolve(ROOT_DIR, "..");
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT_DIR, "data");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
export const USERS_FILE = path.join(DATA_DIR, "users.json");
export const FRONTEND_DIST_DIR = path.join(PROJECT_ROOT, "frontend", "dist");

export const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || "development-secret",
  hfToken: process.env.HF_TOKEN || "",
  hfChatModel: process.env.HF_CHAT_MODEL || "Qwen/Qwen2.5-7B-Instruct",
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173"
};
