import { createHash, randomUUID } from "node:crypto";
import type { HubActor, HubState } from "./hub-types";
import { HubError, text } from "./hub-domain";
import {
  emptyFinance,
  type FinanceState,
  type FinanceItem,
  type FinanceView,
} from "./finance-types";
import { dollars, balances, savedTotal } from "./finance-money";
type Member = { id: string; name: string };
const amount = (v: unknown, zero = false) => {
  if (
    typeof v !== "number" ||
    !Number.isSafeInteger(v) ||
    v < (zero ? 0 : 1) ||
    v > 100000000
  )
    throw new HubError(
      "Enter a USD amount from $0.01 to $1,000,000 with at most two decimal places.",
    );
  return v;
};
function date(v: unknown, optional = false) {
  if (optional && v === "") return "";
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    !Number.isFinite(Date.parse(v)) ||
    new Date(v).toISOString().slice(0, 10) !== v
  )
    throw new HubError("Choose a valid calendar date.");
  return v;
}
function choice(v: unknown, values: string[]) {
  if (typeof v !== "string" || !values.includes(v))
    throw new HubError("Choose a valid option.");
  return v;
}
export function paypalHandle(v: unknown) {
  const input = text(v, 120);
  if (!input) return "";
  if (/^[a-zA-Z0-9]{3,20}$/.test(input)) return input;
  try {
    const u = new URL(input);
    if (
      u.protocol === "https:" &&
      u.hostname === "paypal.me" &&
      !u.port &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      /^\/[a-zA-Z0-9]{3,20}\/?$/.test(u.pathname)
    )
      return u.pathname.split("/")[1];
  } catch {}
  throw new HubError(
    "Enter your PayPal.Me username, such as WillowParent. A full https://paypal.me/WillowParent link also works; leave off any amount or query.",
  );
}
export function financeView(
  s: HubState,
  a: HubActor,
  members: Member[],
): FinanceView {
  if (a.role !== "parent")
    throw new HubError("Family finances are for parents only.", 403);
  const f = s.finance ?? emptyFinance();
  return { ...f, viewer: a.id, members, balances: balances(f, members) };
}
export function paypalDestination(
  f: FinanceState,
  a: HubActor,
  members: Member[],
  id: string,
) {
  if (a.role !== "parent")
    throw new HubError("Family finances are for parents only.", 403);
  const p = f.payments.find((p) => p.id === id);
  if (!p) throw new HubError("Payment not found.", 404);
  if (p.sender !== a.id)
    throw new HubError("Only the sender can open this payment handoff.", 403);
  if (p.status !== "prepared" || p.method !== "paypal")
    throw new HubError("This payment is no longer ready for PayPal.", 409);
  const link = f.links[p.recipient];
  if (
    !link?.handle ||
    link.handle !== p.handle ||
    link.version !== p.linkVersion
  )
    throw new HubError(
      "The recipient's PayPal link changed. Cancel this record and prepare a new payment.",
      409,
    );
  if (
    p.purpose === "reimbursement" &&
    p.amount > Math.max(0, -(balances(f, members)[a.id] ?? 0))
  )
    throw new HubError(
      "The expense balance changed. Review it before preparing a new payment.",
      409,
    );
  return `https://paypal.me/${paypalHandle(p.handle)}/${dollars(p.amount)}USD`;
}
export function mutateFinance(
  s: HubState,
  a: HubActor,
  members: Member[],
  b: Record<string, unknown>,
  now = new Date().toISOString(),
) {
  if (a.role !== "parent")
    throw new HubError("Family finances are for parents only.", 403);
  if (b.viewer !== a.id)
    throw new HubError(
      "The signed-in account changed. Reload before saving.",
      409,
    );
  if (typeof b.key !== "string" || !/^[a-zA-Z0-9_-]{16,100}$/.test(b.key))
    throw new HubError("Retry this action from the finance screen.");
  const fingerprint = createHash("sha256")
      .update(JSON.stringify(b))
      .digest("hex"),
    key = `${a.id}:finance:${b.key}`;
  if (s.requests[key]) {
    if (s.requests[key] !== fingerprint)
      throw new HubError(
        "This retry changed. Please retry the updated action.",
        409,
      );
    return false;
  }
  const f = (s.finance ??= emptyFinance());
  const parent = (id: unknown) => {
    if (typeof id !== "string" || !members.some((m) => m.id === id))
      throw new HubError("Choose a parent in this household.");
    return id;
  };
  const base = (): FinanceItem => ({
    id: randomUUID(),
    version: 1,
    by: a.id,
    at: now,
  });
  const find = <T extends FinanceItem>(items: T[]) => {
    const item = items.find((i) => i.id === b.id);
    if (!item) throw new HubError("Record not found.", 404);
    if (b.version !== item.version)
      throw new HubError(
        "This record changed. Your draft is kept; load the latest before saving.",
        409,
      );
    return item;
  };
  const event = (entity: string, action: string, value: any) =>
    f.events.push({
      id: randomUUID(),
      entity,
      action,
      actor: a.id,
      name: a.name,
      at: now,
      snapshot: structuredClone(value),
    });
  if (b.op === "link") {
    const old = f.links[a.id];
    if (b.version !== (old?.version ?? 0))
      throw new HubError(
        "Your payment link changed. Load the latest before saving.",
        409,
      );
    f.links[a.id] = {
      handle: paypalHandle(b.handle),
      version: (old?.version ?? 0) + 1,
    };
    event(a.id, "Updated own PayPal link", { handle: f.links[a.id].handle });
  } else if (b.op === "expense") {
    const old = b.id ? find(f.expenses) : undefined;
    if (old?.voided)
      throw new HubError("A voided expense cannot be edited.", 409);
    const total = amount(b.amount),
      paidBy = parent(b.paidBy),
      shares: Record<string, number> = {};
    if (!b.shares || typeof b.shares !== "object" || Array.isArray(b.shares))
      throw new HubError("Set each parent's share.");
    const raw = b.shares as Record<string, unknown>;
    if (Object.keys(raw).length !== members.length)
      throw new HubError("Set a share for each household parent.");
    for (const m of members) shares[m.id] = amount(raw[m.id], true);
    if (Object.values(shares).reduce((n, v) => n + v, 0) !== total)
      throw new HubError("The two shares must add up to the expense total.");
    const value = {
      ...(old ?? base()),
      version: old ? old.version + 1 : 1,
      title: text(b.title, 120, true),
      category: choice(b.category, [
        "school",
        "medical",
        "travel",
        "activities",
        "other",
      ]),
      amount: total,
      paidBy,
      shares,
      date: date(b.date),
      note: text(b.note, 1500),
      voided: false,
    };
    if (old) Object.assign(old, value);
    else f.expenses.push(value);
    event(value.id, old ? "Edited expense" : "Added expense", value);
  } else if (b.op === "voidExpense") {
    const e = find(f.expenses);
    if (e.voided) throw new HubError("This expense is already voided.", 409);
    text(b.note, 300, true);
    e.voided = true;
    e.version++;
    event(e.id, "Voided expense: " + b.note, e);
  } else if (b.op === "payment") {
    const recipient = parent(b.recipient);
    if (recipient === a.id)
      throw new HubError("Choose the other parent as recipient.");
    const total = amount(b.amount),
      purpose = choice(b.purpose, ["reimbursement", "other"]) as
        "reimbursement" | "other",
      method = choice(b.method, ["paypal", "other"]) as "paypal" | "other";
    if (purpose === "reimbursement") {
      const owing = Math.max(0, -(balances(f, members)[a.id] ?? 0));
      const reserved = f.payments
        .filter(
          (p) =>
            p.sender === a.id &&
            p.purpose === "reimbursement" &&
            ["prepared", "sent", "not_received"].includes(p.status),
        )
        .reduce((n, p) => n + p.amount, 0);
      if (total > owing - reserved)
        throw new HubError(
          "This exceeds the unreserved expense balance. Review pending payments, or choose Other money for an unrelated transfer.",
          409,
        );
    }
    const link = f.links[recipient];
    if (method === "paypal" && !link?.handle)
      throw new HubError(
        "The recipient needs to save their PayPal.Me link first, or choose Other method.",
      );
    const p = {
      ...base(),
      sender: a.id,
      recipient,
      amount: total,
      reason: text(b.reason, 300, true),
      purpose,
      method,
      status: "prepared" as const,
      handle: method === "paypal" ? link.handle : "",
      linkVersion: method === "paypal" ? link.version : 0,
    };
    f.payments.push(p);
    event(p.id, "Prepared payment · no money sent by the app", p);
  } else if (
    [
      "sent",
      "received",
      "notReceived",
      "cancelPayment",
      "closeUnreceived",
    ].includes(String(b.op))
  ) {
    const p = find(f.payments);
    if (b.op === "sent") {
      if (p.sender !== a.id)
        throw new HubError("Only the sender can mark money sent.", 403);
      if (p.status !== "prepared")
        throw new HubError("This payment is no longer awaiting sending.", 409);
      p.status = "sent";
    } else if (b.op === "cancelPayment") {
      if (p.sender !== a.id)
        throw new HubError(
          "Only the sender can cancel their payment record.",
          403,
        );
      if (p.status !== "prepared")
        throw new HubError("Only an unsent payment can be cancelled.", 409);
      p.status = "cancelled";
    } else if (b.op === "closeUnreceived") {
      if (p.recipient !== a.id)
        throw new HubError(
          "Only the recipient can close an unreceived payment record.",
          403,
        );
      if (p.status !== "not_received")
        throw new HubError(
          "First report that this money was not received.",
          409,
        );
      text(b.note, 300, true);
      p.status = "cancelled";
    } else {
      if (p.recipient !== a.id)
        throw new HubError(
          "Only the recipient can confirm whether money arrived.",
          403,
        );
      if (!["sent", "not_received"].includes(p.status))
        throw new HubError(
          "This payment is not awaiting a receipt decision.",
          409,
        );
      if (b.op === "notReceived" && p.status === "not_received")
        throw new HubError("This is already marked not received.", 409);
      p.status = b.op === "received" ? "received" : "not_received";
    }
    p.version++;
    event(
      p.id,
      p.status === "received"
        ? "Recipient confirmed receipt"
        : p.status === "sent"
          ? "Sender marked money sent"
          : p.status === "not_received"
            ? "Recipient reported money not received"
            : b.op === "closeUnreceived"
              ? "Recipient closed unreceived record: " + text(b.note, 300, true)
              : "Cancelled unsent payment",
      p,
    );
  } else if (b.op === "goal") {
    const old = b.id ? find(f.goals) : undefined;
    const g = {
      ...(old ?? base()),
      version: old ? old.version + 1 : 1,
      title: text(b.title, 120, true),
      category: choice(b.category, [
        "college",
        "trip",
        "medical",
        "emergency",
        "other",
      ]),
      target: amount(b.target),
      date: date(b.date, true),
      note: text(b.note, 1500),
      archived: old?.archived ?? false,
    };
    if (old) Object.assign(old, g);
    else f.goals.push(g);
    event(g.id, old ? "Edited savings goal" : "Created savings goal", g);
  } else if (b.op === "archiveGoal") {
    const g = find(f.goals);
    g.archived = !g.archived;
    g.version++;
    event(
      g.id,
      g.archived ? "Archived savings goal" : "Restored savings goal",
      g,
    );
  } else if (b.op === "contribution") {
    const g = f.goals.find((g) => g.id === b.goal);
    if (!g) throw new HubError("Savings goal not found.", 404);
    if (g.archived)
      throw new HubError(
        "Restore this goal before recording a contribution.",
        409,
      );
    const direction = choice(b.direction, ["deposit", "withdrawal"]) as
        "deposit" | "withdrawal",
      total = amount(b.amount);
    if (direction === "withdrawal" && total > savedTotal(f, g.id))
      throw new HubError(
        "A withdrawal cannot exceed the recorded savings total.",
        409,
      );
    const c = {
      ...base(),
      goal: g.id,
      amount: total,
      direction,
      date: date(b.date),
      note: text(b.note, 500),
      voided: false,
    };
    f.contributions.push(c);
    event(c.id, "Recorded savings " + direction, c);
  } else if (b.op === "voidContribution") {
    const c = find(f.contributions);
    if (c.by !== a.id)
      throw new HubError(
        "Only the parent who recorded this entry can void it.",
        403,
      );
    if (c.voided) throw new HubError("This entry is already voided.", 409);
    const reason = text(b.note, 300, true);
    if (c.direction === "deposit" && savedTotal(f, c.goal) < c.amount)
      throw new HubError(
        "Voiding this deposit would make the recorded total negative. Correct withdrawals first.",
        409,
      );
    c.voided = true;
    c.version++;
    event(c.id, "Voided savings entry: " + reason, c);
  } else throw new HubError("Finance action not found.", 404);
  s.requests[key] = fingerprint;
  return true;
}
