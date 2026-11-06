export type Homework = {
  id: string;
  title: string;
  due: string;
  status: "not_started" | "in_progress" | "done";
  note: string;
  version: number;
  created_at: string;
  updated_at: string;
};
export type HomeworkEvent = {
  id: number;
  actor: string;
  action: "created" | "edited" | "noted" | "started" | "done";
  at: string;
  snapshot: Homework;
};
export type HomeworkDetail = Homework & { events: HomeworkEvent[] };
