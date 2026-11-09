import type { FinanceState } from "./finance-types";
type Member = { id: string; name: string };
// All stored amounts are integer USD cents, including split shares.
export function parseDollars(value: string): number {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(value.trim()))
    throw Error("Enter a USD amount with up to two decimal places.");
  const [whole, fraction = ""] = value.trim().split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (cents > 100000000) throw Error("Amounts can be up to $1,000,000.");
  return cents;
}
export const dollars = (cents: number) => (cents / 100).toFixed(2);
export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );

export function balances(f: FinanceState, members: Member[]) {
  const result = Object.fromEntries(members.map((m) => [m.id, 0]));
  for (const e of f.expenses.filter((e) => !e.voided)) {
    result[e.paidBy] = (result[e.paidBy] ?? 0) + e.amount;
    for (const [id, share] of Object.entries(e.shares))
      result[id] = (result[id] ?? 0) - share;
  }
  for (const p of f.payments.filter(
    (p) => p.status === "received" && p.purpose === "reimbursement",
  )) {
    result[p.sender] = (result[p.sender] ?? 0) + p.amount;
    result[p.recipient] = (result[p.recipient] ?? 0) - p.amount;
  }
  return result;
}
export const savedTotal = (f: FinanceState, goal: string) =>
  f.contributions
    .filter((c) => c.goal === goal && !c.voided)
    .reduce(
      (n, c) => n + (c.direction === "deposit" ? c.amount : -c.amount),
      0,
    );
