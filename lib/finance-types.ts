export type FinanceItem = {
  id: string;
  version: number;
  by: string;
  at: string;
};
export type Expense = FinanceItem & {
  title: string;
  category: string;
  amount: number;
  paidBy: string;
  shares: Record<string, number>;
  date: string;
  note: string;
  voided: boolean;
};
export type Payment = FinanceItem & {
  sender: string;
  recipient: string;
  amount: number;
  reason: string;
  purpose: "reimbursement" | "other";
  method: "paypal" | "other";
  status: "prepared" | "sent" | "received" | "not_received" | "cancelled";
  handle: string;
  linkVersion: number;
};
export type SavingGoal = FinanceItem & {
  title: string;
  category: string;
  target: number;
  date: string;
  note: string;
  archived: boolean;
};
export type Contribution = FinanceItem & {
  goal: string;
  amount: number;
  direction: "deposit" | "withdrawal";
  date: string;
  note: string;
  voided: boolean;
};
export type FinanceEvent = {
  id: string;
  entity: string;
  actor: string;
  name: string;
  at: string;
  action: string;
  snapshot: Expense | Payment | SavingGoal | Contribution | { handle: string };
};
export type FinanceState = {
  expenses: Expense[];
  payments: Payment[];
  goals: SavingGoal[];
  contributions: Contribution[];
  links: Record<string, { handle: string; version: number }>;
  events: FinanceEvent[];
};
export type FinanceView = FinanceState & {
  viewer: string;
  members: { id: string; name: string }[];
  balances: Record<string, number>;
};
export const emptyFinance = (): FinanceState => ({
  expenses: [],
  payments: [],
  goals: [],
  contributions: [],
  links: {},
  events: [],
});
