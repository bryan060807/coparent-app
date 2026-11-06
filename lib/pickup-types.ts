export type Pickup = {
  id: string;
  title: string;
  scheduled_at: string;
  location: string;
  assignee: string;
  assignee_name: string;
  note: string;
  status: "scheduled" | "completed" | "cancelled";
  version: number;
  created_at: string;
  updated_at: string;
};
export type PickupEvent = {
  id: number;
  actor: string;
  action: "created" | "edited" | "completed" | "cancelled";
  at: string;
  snapshot: Pickup;
};
export type PickupDetail = Pickup & { events: PickupEvent[] };
