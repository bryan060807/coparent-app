import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
export const dataDir = path.resolve(process.env.DATA_DIR || "./data");
mkdirSync(path.join(dataDir, "attachments"), { recursive: true, mode: 0o700 });
export const db = new DatabaseSync(path.join(dataDir, "family.sqlite"));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS households(id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, household TEXT NOT NULL REFERENCES households(id), name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS papers(id TEXT PRIMARY KEY, household TEXT NOT NULL REFERENCES households(id),title TEXT NOT NULL,due TEXT NOT NULL,assignee TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL DEFAULT 'added',note TEXT NOT NULL DEFAULT '',file TEXT NOT NULL,mime TEXT NOT NULL,original TEXT NOT NULL,created TEXT NOT NULL,creator TEXT NOT NULL REFERENCES users(id),request_key TEXT NOT NULL,UNIQUE(creator,request_key));
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,paper TEXT NOT NULL REFERENCES papers(id),actor TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',at TEXT NOT NULL,UNIQUE(paper,action));`);
export function hash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function verify(password: string, stored: string) {
  const [salt, h] = stored.split(":");
  return timingSafeEqual(Buffer.from(h, "hex"), scryptSync(password, salt, 64));
}
export type User = {
  id: string;
  household: string;
  name: string;
  email: string;
};
