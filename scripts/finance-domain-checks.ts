import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyHub, type HubActor } from "../lib/hub-types";
import {
  mutateFinance,
  financeView,
  paypalDestination,
  paypalHandle,
} from "../lib/finance-domain";
import { parseDollars, balances, savedTotal } from "../lib/finance-money";
const a: HubActor = {
    id: randomUUID(),
    name: "Alex Willow",
    role: "parent",
    household: randomUUID(),
  },
  b: HubActor = { ...a, id: randomUUID(), name: "Sam Willow" },
  child: HubActor = { ...a, id: randomUUID(), role: "child", name: "Bill" };
const members = [a, b],
  state = emptyHub();
const fail = (fn: () => unknown, status: number) =>
  assert.throws(fn, (e: any) => e.status === status);
const save = (who: HubActor, body: Record<string, unknown>) =>
  mutateFinance(state, who, members, {
    viewer: who.id,
    key: randomUUID(),
    ...body,
  });
assert.equal(parseDollars("0.01"), 1);
assert.equal(parseDollars("100.01"), 10001);
for (const v of ["NaN", "1e4", "-1", "2.001", "0x10", "1000001"])
  assert.throws(() => parseDollars(v));
for (const v of [
  "https://evil.test/abc",
  "https://paypal.me.evil.test/abc",
  "javascript:alert(1)",
  "https://paypal.me/abc?x=1",
  "https://me:pass@paypal.me/abc",
  "https://paypal.me/abc/2USD",
])
  fail(() => paypalHandle(v), 400);
assert.equal(paypalHandle("https://paypal.me/FictionalSam/"), "FictionalSam");
fail(() => save(child, { op: "expense" }), 403);
fail(() => financeView(state, child, members), 403);
fail(() => save(a, { op: "link", viewer: b.id }), 409);
const exp = {
  op: "expense",
  title: "Fictional school trip",
  category: "school",
  amount: 10001,
  paidBy: a.id,
  shares: { [a.id]: 5001, [b.id]: 5000 },
  date: "2026-11-09",
  note: "Fictional test only",
};
for (const amount of [0, 1.1, NaN, 100000001, "100"])
  fail(() => save(a, { ...exp, amount }), 400);
fail(() => save(a, { ...exp, date: "2026-02-30" }), 400);
fail(() => save(a, { ...exp, shares: { [a.id]: 5000, [b.id]: 5000 } }), 400);
fail(() => save(a, { ...exp, paidBy: randomUUID() }), 400);
save(a, exp);
const f = state.finance!,
  e = f.expenses[0];
assert.deepEqual(balances(f, members), { [a.id]: 5000, [b.id]: -5000 });
save(a, { op: "link", version: 0, handle: "FictionalAlex" });
save(b, {
  op: "payment",
  recipient: a.id,
  amount: 2000,
  purpose: "reimbursement",
  method: "paypal",
  reason: "Trip share",
});
const p = f.payments[0];
assert.equal(
  paypalDestination(f, b, members, p.id),
  "https://paypal.me/FictionalAlex/20.00USD",
);
fail(() => paypalDestination(f, a, members, p.id), 403);
fail(() => save(a, { op: "sent", id: p.id, version: p.version }), 403);
fail(() => save(b, { op: "received", id: p.id, version: p.version }), 403);
fail(
  () =>
    save(b, {
      op: "payment",
      recipient: a.id,
      amount: 3001,
      purpose: "reimbursement",
      method: "paypal",
      reason: "Overspend",
    }),
  409,
);
const sent = {
  viewer: b.id,
  key: randomUUID(),
  op: "sent",
  id: p.id,
  version: p.version,
};
assert.equal(mutateFinance(state, b, members, sent), true);
assert.equal(mutateFinance(state, b, members, sent), false);
assert.equal(
  balances(f, members)[b.id],
  -5000,
  "Sent alone does not settle a debt",
);
save(a, { op: "notReceived", id: p.id, version: p.version });
save(a, { op: "received", id: p.id, version: p.version });
assert.equal(balances(f, members)[b.id], -3000);
fail(() => save(a, { op: "notReceived", id: p.id, version: p.version }), 409);
fail(() => save(b, { op: "cancelPayment", id: p.id, version: p.version }), 409);
assert.equal(
  f.events.filter((e) => e.action === "Recipient confirmed receipt").length,
  1,
);
save(b, {
  op: "payment",
  recipient: a.id,
  amount: 1000,
  purpose: "other",
  method: "other",
  reason: "Fictional birthday present",
});
const gift = f.payments[1];
save(b, { op: "sent", id: gift.id, version: 1 });
save(a, { op: "received", id: gift.id, version: 2 });
assert.equal(
  balances(f, members)[b.id],
  -3000,
  "Other money stays out of expense balance",
);
save(b, {
  op: "payment",
  recipient: a.id,
  amount: 1000,
  purpose: "reimbursement",
  method: "paypal",
  reason: "Partial reimbursement",
});
save(a, { op: "link", version: 1, handle: "FictionalNewAlex" });
fail(() => paypalDestination(f, b, members, f.payments[2].id), 409);
save(b, { op: "cancelPayment", id: f.payments[2].id, version: 1 });
save(a, {
  op: "expense",
  ...e,
  version: 1,
  shares: { [a.id]: 10001, [b.id]: 0 },
});
assert.equal(
  balances(f, members)[b.id],
  2000,
  "Expense corrections retain actual received credits",
);
fail(() => save(b, { ...exp, id: e.id, version: 1 }), 409);
save(a, {
  op: "goal",
  title: "College fund",
  category: "college",
  target: 1000000,
  date: "2040-09-01",
  note: "Manual test fund",
});
const g = f.goals[0];
save(a, {
  op: "contribution",
  goal: g.id,
  amount: 5000,
  direction: "deposit",
  date: "2026-11-09",
  note: "",
});
save(b, {
  op: "contribution",
  goal: g.id,
  amount: 1000,
  direction: "withdrawal",
  date: "2026-11-09",
  note: "",
});
assert.equal(savedTotal(f, g.id), 4000);
fail(
  () =>
    save(a, {
      op: "voidContribution",
      id: f.contributions[0].id,
      version: 1,
      note: "Correction",
    }),
  409,
);
fail(
  () =>
    save(a, {
      op: "voidContribution",
      id: f.contributions[1].id,
      version: 1,
      note: "Correction",
    }),
  403,
);
save(b, {
  op: "voidContribution",
  id: f.contributions[1].id,
  version: 1,
  note: "Correction",
});
save(a, {
  op: "voidContribution",
  id: f.contributions[0].id,
  version: 1,
  note: "Correction",
});
assert.equal(savedTotal(f, g.id), 0);
save(a, {
  op: "payment",
  recipient: b.id,
  amount: 500,
  purpose: "other",
  method: "other",
  reason: "Mistaken send record",
});
const unreceived = f.payments.at(-1)!;
save(a, { op: "sent", id: unreceived.id, version: 1 });
save(b, { op: "notReceived", id: unreceived.id, version: 2 });
fail(
  () =>
    save(a, {
      op: "closeUnreceived",
      id: unreceived.id,
      version: 3,
      note: "Not allowed",
    }),
  403,
);
save(b, {
  op: "closeUnreceived",
  id: unreceived.id,
  version: 3,
  note: "We checked together; never transferred",
});
assert.equal(unreceived.status, "cancelled");
fail(() => save(b, { op: "received", id: unreceived.id, version: 4 }), 409);
console.log(
  "PASS: exact USD math, splits, actor restrictions, receipt state machine, retry idempotency, pending-payment reservations, safe PayPal destinations, link changes, credits, and manual savings corrections.",
);
