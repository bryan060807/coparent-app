import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
export const dataDir = path.resolve(process.env.DATA_DIR || "./data");
mkdirSync(path.join(dataDir, "attachments"), { recursive: true, mode: 0o700 });
// Keep one initialized connection per database across Next.js development reloads.
// Authentication and household membership are still checked on every request.
declare global {
  var __twoHomesDatabases: Map<string, DatabaseSync> | undefined;
}
const connections = (globalThis.__twoHomesDatabases ??= new Map());
const filename = path.join(dataDir, "family.sqlite");
function isBusy(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "errcode" in error &&
    (error.errcode === 5 || error.errcode === 6),
  );
}
function enableWal(connection: DatabaseSync) {
  const deadline = Date.now() + 5000;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  let delay = 25;
  while (true) {
    try {
      const journal = connection.prepare("PRAGMA journal_mode").get() as {
        journal_mode: string;
      };
      if (journal.journal_mode !== "wal")
        connection.exec("PRAGMA journal_mode=WAL");
      return;
    } catch (error) {
      // Journal-mode changes can return BUSY without calling SQLite's busy
      // handler. Retry only lock errors, with a bounded startup-only backoff.
      const remaining = deadline - Date.now();
      if (!isBusy(error) || remaining <= 0) throw error;
      Atomics.wait(pause, 0, 0, Math.min(delay, remaining));
      delay = Math.min(delay * 2, 200);
    }
  }
}
function openDatabase(): DatabaseSync {
  const existing = connections.get(filename);
  if (existing?.isOpen) return existing;

  // Set the busy handler at construction, BEFORE any PRAGMA or migration.
  const connection = new DatabaseSync(filename, { timeout: 5000 });
  try {
    connection.exec("PRAGMA foreign_keys=ON");
    enableWal(connection);
    connection.exec("BEGIN IMMEDIATE");
    connection.exec(`CREATE TABLE IF NOT EXISTS households(id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, household TEXT NOT NULL REFERENCES households(id), name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS papers(id TEXT PRIMARY KEY, household TEXT NOT NULL REFERENCES households(id),title TEXT NOT NULL,due TEXT NOT NULL,assignee TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL DEFAULT 'added',note TEXT NOT NULL DEFAULT '',file TEXT NOT NULL,mime TEXT NOT NULL,original TEXT NOT NULL,created TEXT NOT NULL,creator TEXT NOT NULL REFERENCES users(id),request_key TEXT NOT NULL,UNIQUE(creator,request_key));
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,paper TEXT NOT NULL REFERENCES papers(id),actor TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',at TEXT NOT NULL,UNIQUE(paper,action));
CREATE TABLE IF NOT EXISTS pickups(id TEXT PRIMARY KEY,household TEXT NOT NULL REFERENCES households(id),title TEXT NOT NULL,scheduled_at TEXT NOT NULL,location TEXT NOT NULL,assignee TEXT NOT NULL REFERENCES users(id),note TEXT NOT NULL DEFAULT '',status TEXT NOT NULL CHECK(status IN ('scheduled','completed','cancelled')),version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS pickups_household_time ON pickups(household,scheduled_at);
CREATE TABLE IF NOT EXISTS pickup_events(id INTEGER PRIMARY KEY,pickup TEXT NOT NULL REFERENCES pickups(id),actor TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,at TEXT NOT NULL,snapshot TEXT NOT NULL,request_key TEXT NOT NULL,version INTEGER NOT NULL,UNIQUE(actor,request_key),UNIQUE(pickup,version));
CREATE TABLE IF NOT EXISTS homework(id TEXT PRIMARY KEY,household TEXT NOT NULL REFERENCES households(id),title TEXT NOT NULL,due TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('not_started','in_progress','done')),note TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS homework_household_due ON homework(household,due);
CREATE TABLE IF NOT EXISTS homework_events(id INTEGER PRIMARY KEY,homework TEXT NOT NULL REFERENCES homework(id),actor TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,at TEXT NOT NULL,snapshot TEXT NOT NULL,request_key TEXT NOT NULL,version INTEGER NOT NULL,UNIQUE(actor,request_key),UNIQUE(homework,version));
CREATE TABLE IF NOT EXISTS family_records(id TEXT PRIMARY KEY,household TEXT NOT NULL REFERENCES households(id),kind TEXT NOT NULL CHECK(kind IN ('gifts','routines','info')),data TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS family_records_household ON family_records(household,kind);
CREATE TABLE IF NOT EXISTS family_events(id INTEGER PRIMARY KEY,record TEXT NOT NULL REFERENCES family_records(id),actor TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,at TEXT NOT NULL,snapshot TEXT NOT NULL,request_key TEXT NOT NULL,UNIQUE(actor,request_key));
CREATE TABLE IF NOT EXISTS routine_checks(record TEXT NOT NULL REFERENCES family_records(id),day TEXT NOT NULL,checked INTEGER NOT NULL CHECK(checked IN (0,1)),version INTEGER NOT NULL,actor TEXT NOT NULL REFERENCES users(id),at TEXT NOT NULL,PRIMARY KEY(record,day));
CREATE TABLE IF NOT EXISTS family_settings(household TEXT PRIMARY KEY REFERENCES households(id),timezone TEXT NOT NULL,version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS family_timezone_events(id INTEGER PRIMARY KEY,household TEXT NOT NULL REFERENCES households(id),actor TEXT NOT NULL REFERENCES users(id),request_key TEXT NOT NULL,timezone TEXT NOT NULL,at TEXT NOT NULL,UNIQUE(actor,request_key));`);
    connection.exec("COMMIT");
    connections.set(filename, connection);
    return connection;
  } catch (error) {
    // Closing also rolls back incomplete migrations. Never cache a failed open.
    connection.close();
    if (isBusy(error)) {
      throw new Error(
        "The Two Homes database is busy. Stop other copies of this app or database editors, then restart this server. Do not delete the data directory.",
        { cause: error },
      );
    }
    throw error;
  }
}
export const db = openDatabase();
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
