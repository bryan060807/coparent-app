import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

function fixture(mode: "DELETE" | "WAL" = "DELETE") {
  const dir = mkdtempSync(path.join(tmpdir(), "two-homes-db-"));
  const filename = path.join(dir, "family.sqlite");
  const db = new DatabaseSync(filename);
  db.exec(
    `PRAGMA journal_mode=${mode}; CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES('keep me');`,
  );
  db.close();
  return {
    dir,
    filename,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
function worker(source: string, dir: string, args: string[] = []) {
  const child = spawn(
    "node",
    ["--import", "tsx", "--input-type=module", "-e", source, ...args],
    {
      env: { ...process.env, DATA_DIR: dir },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (b) => (stdout += b));
  child.stderr.on("data", (b) => (stderr += b));
  const done = new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });
  return { child, done };
}
async function lock(dir: string, filename: string, duration: number) {
  const job = worker(
    `import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync(process.argv[1]); db.exec("BEGIN IMMEDIATE; UPDATE sentinel SET value='pending'"); console.log('LOCKED'); setTimeout(()=>{db.exec('ROLLBACK'); db.close();},${duration});`,
    dir,
    [filename],
  );
  await new Promise<void>((resolve, reject) => {
    job.child.stdout.once("data", () => resolve());
    job.child.once("error", reject);
    void job.done.then((result) => {
      if (result.code !== 0) reject(Error(result.stderr));
    });
  });
  return job;
}
const ready = `import assert from 'node:assert/strict'; const {db}=await import('./lib/db.ts'); assert.equal(db.prepare('SELECT value FROM sentinel').get().value,'keep me'); assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode,'wal'); assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='pickups'").get().n,1); console.log('READY'); db.close();`;

test(
  "startup waits for a temporary lock before converting an existing database to WAL",
  { timeout: 12000 },
  async () => {
    const f = fixture();
    let holder: Awaited<ReturnType<typeof lock>> | undefined;
    try {
      holder = await lock(f.dir, f.filename, 1200);
      const began = Date.now();
      const result = await worker(ready, f.dir).done;
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /READY/);
      assert.ok(
        Date.now() - began >= 500,
        "startup should wait for the held lock",
      );
      await holder.done;
    } finally {
      holder?.child.kill("SIGTERM");
      f.cleanup();
    }
  },
);

test(
  "development reloads reuse a connection and do not rerun initialization inside an active transaction",
  { timeout: 12000 },
  async () => {
    const f = fixture("WAL");
    try {
      const result = await worker(
        `import assert from 'node:assert/strict';
 const first=await import('./lib/db.ts?first'); first.db.exec("BEGIN IMMEDIATE; UPDATE sentinel SET value='pending'");
 const reloaded=await import('./lib/db.ts?reload'); assert.equal(reloaded.db,first.db); assert.equal(reloaded.db.isTransaction,true); assert.equal(reloaded.db.prepare('SELECT value FROM sentinel').get().value,'pending'); first.db.exec('ROLLBACK');first.db.close();
 const reopened=await import('./lib/db.ts?closed'); assert.notEqual(reopened.db,first.db); assert.equal(reopened.db.prepare('SELECT value FROM sentinel').get().value,'keep me'); reopened.db.close(); console.log('REUSED');`,
        f.dir,
      ).done;
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /REUSED/);
    } finally {
      f.cleanup();
    }
  },
);

test(
  "concurrent process startup safely initializes the same existing database",
  { timeout: 12000 },
  async () => {
    const f = fixture();
    try {
      const results = await Promise.all(
        Array.from({ length: 4 }, () => worker(ready, f.dir).done),
      );
      for (const result of results) assert.equal(result.code, 0, result.stderr);
      const db = new DatabaseSync(f.filename);
      assert.equal(db.prepare("PRAGMA quick_check").get()?.quick_check, "ok");
      assert.equal(
        db.prepare("SELECT value FROM sentinel").get()?.value,
        "keep me",
      );
      db.close();
    } finally {
      f.cleanup();
    }
  },
);

test(
  "a persistent lock has a bounded timeout, preserves data, and does not cache a failed connection",
  { timeout: 15000 },
  async () => {
    const f = fixture("WAL");
    let holder: Awaited<ReturnType<typeof lock>> | undefined;
    try {
      holder = await lock(f.dir, f.filename, 6500);
      const began = Date.now();
      const result = await worker(
        `import assert from 'node:assert/strict'; await assert.rejects(import('./lib/db.ts'),/database is busy/); assert.equal(globalThis.__twoHomesDatabases.size,0); console.log('EXPECTED_BUSY');`,
        f.dir,
      ).done;
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /EXPECTED_BUSY/);
      assert.ok(
        Date.now() - began >= 4500,
        "the configured timeout should run before failing",
      );
      await holder.done;
      const retry = await worker(ready, f.dir).done;
      assert.equal(retry.code, 0, retry.stderr);
    } finally {
      holder?.child.kill("SIGTERM");
      f.cleanup();
    }
  },
);
