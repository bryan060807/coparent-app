export type FamilyKind = "gifts" | "routines" | "info";
export type GiftData = {
  title: string;
  type: "gift" | "money_in" | "money_out";
  date: string;
  from: string;
  occasion: string;
  amountCents: number | null;
  thankYou: boolean;
  note: string;
};
export type RoutineData = {
  title: string;
  type: "routine" | "chore";
  days: number[];
  time: string;
  home: string;
  note: string;
};
export type InfoData = {
  title: string;
  category: "health" | "personal" | "emergency" | "school" | "other";
  details: string;
  important: boolean;
};
export type FamilyData = GiftData | RoutineData | InfoData;
export type DailyCheck = {
  day: string;
  checked: boolean;
  version: number;
  actor: string | null;
  at: string | null;
};
export type FamilyRecord = {
  id: string;
  kind: FamilyKind;
  data: FamilyData;
  archived: boolean;
  version: number;
  created_at: string;
  updated_at: string;
  check?: DailyCheck;
  scheduledToday?: boolean;
};
export type FamilyContext = {
  day: string;
  weekday: number;
  timezone: string;
  timezoneVersion: number;
};
export type FamilyEvent = {
  id: number;
  action: string;
  actor: string;
  at: string;
  snapshot: FamilyRecord & {
    day?: string;
    checked?: boolean;
    timezone?: string;
  };
};
export type FamilyDetail = {
  record: FamilyRecord;
  events: FamilyEvent[];
  context: FamilyContext;
  checks: DailyCheck[];
};
export type FamilyList = {
  records: FamilyRecord[];
  context: FamilyContext;
  totals?: { receivedCents: number; spentCents: number; balanceCents: number };
};
