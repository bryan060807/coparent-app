import { db, hash } from "../lib/db";
if (process.env.NODE_ENV === "production")
  throw Error("Seeding is development-only.");
const password = "Backpack-demo-26!";
db.exec("BEGIN IMMEDIATE");
try {
  db.prepare("INSERT OR IGNORE INTO households VALUES(?,?)").run(
    "willow",
    "Willow family",
  );
  db.prepare("INSERT OR IGNORE INTO households VALUES(?,?)").run(
    "cedar",
    "Cedar family",
  );
  for (const [id, household, name, email] of [
    ["alex", "willow", "Alex Willow", "alex@example.test"],
    ["sam", "willow", "Sam Willow", "sam@example.test"],
    ["jordan", "cedar", "Jordan Cedar", "jordan@example.test"],
  ])
    db.prepare("INSERT OR IGNORE INTO users VALUES(?,?,?,?,?)").run(
      id,
      household,
      name,
      email,
      hash(password),
    );
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
}
console.log(
  "Fictional development accounts ready: alex@example.test, sam@example.test, jordan@example.test. Password for each: " +
    password +
    "\nSample: fixtures/permission-slip.pdf. Existing data is preserved.",
);
