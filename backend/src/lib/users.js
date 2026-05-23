import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";

import { USERS_FILE } from "../config.js";
import { ensureJsonFile, readJson, writeJson } from "./fs-store.js";

export async function getUsers() {
  await ensureJsonFile(USERS_FILE, []);
  return readJson(USERS_FILE, []);
}

export async function findUserByEmail(email) {
  const users = await getUsers();
  return users.find((user) => user.email.toLowerCase() === email.toLowerCase()) || null;
}

export async function createUser({ name, email, password }) {
  const users = await getUsers();
  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: uuidv4(),
    name,
    email: email.toLowerCase(),
    passwordHash,
    createdAt: new Date().toISOString()
  };
  users.push(user);
  await writeJson(USERS_FILE, users);
  return sanitizeUser(user);
}

export async function verifyUser(email, password) {
  const user = await findUserByEmail(email);
  if (!user) return null;
  const isValid = await bcrypt.compare(password, user.passwordHash);
  return isValid ? sanitizeUser(user) : null;
}

export function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, ...safeUser } = user;
  return safeUser;
}
