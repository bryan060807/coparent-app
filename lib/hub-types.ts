export type Appearance = {
  theme: "forest" | "ocean" | "sunset" | "berry";
  font: "friendly" | "simple" | "editorial";
  background: "plain" | "confetti" | "waves" | string;
  largeText: boolean;
  reduceMotion: boolean;
};
export const defaultAppearance: Appearance = {
  theme: "forest",
  font: "friendly",
  background: "plain",
  largeText: false,
  reduceMotion: false,
};
export type HubItem = {
  id: string;
  version: number;
  by: string;
  actor: string;
  at: string;
  updatedAt: string;
};
export type Photo = HubItem & {
  caption: string;
  childVisible: boolean;
  file: string;
  mime: string;
  uploadId: string;
};
export type Resource = HubItem & {
  title: string;
  details: string;
  url: string;
  audience: "parents" | "child";
};
export type Contact = HubItem & {
  name: string;
  role: string;
  phone: string;
  email: string;
  note: string;
  childVisible: boolean;
  important: boolean;
};
export type Message = HubItem & { text: string };
export type Exercise = HubItem & {
  question: string;
  answers: Record<string, string>;
  plan: string;
  approvals: string[];
};
export type Goal = HubItem & { title: string; cost: number; archived: boolean };
export type Recognition = HubItem & { text: string; stars: number };
export type Redemption = HubItem & {
  goal: string;
  title: string;
  cost: number;
  status: "requested" | "approved" | "declined";
  decidedBy?: string;
  decidedAt?: string;
};
export type Profile = {
  name: string;
  about: string;
  avatar: string;
  appearance: Appearance;
  version: number;
};
export type ChildAccount = {
  id: string;
  username: string;
  passwordHash: string;
  credentialVersion: string;
  enabled: boolean;
};
export type HubState = {
  photos: Photo[];
  resources: Resource[];
  contacts: Contact[];
  messages: Message[];
  exercises: Exercise[];
  goals: Goal[];
  recognitions: Recognition[];
  redemptions: Redemption[];
  profiles: Record<string, Profile>;
  child?: ChildAccount;
  requests: Record<string, string>;
};
export type Award = {
  record: string;
  day: string;
  title: string;
  active: boolean;
  at: string;
};
export type HubActor = {
  id: string;
  household: string;
  name: string;
  role: "parent" | "child";
};
export type HubView = {
  viewer: string;
  role: "parent" | "child";
  version: number;
  photos: Photo[];
  resources: Resource[];
  contacts: Contact[];
  messages: Message[];
  hasOlderMessages: boolean;
  exercises: Exercise[];
  goals: Goal[];
  recognitions: Recognition[];
  redemptions: Redemption[];
  profile: Profile;
  child?: { username: string; enabled: boolean; version: string };
  awards: Award[];
  balance: number;
  members: { id: string; name: string }[];
  chores: { id: string; title: string; checked: boolean; type: string }[];
};
export const consistencyQuestions = [
  "What should bedtime look like in both homes?",
  "What are our shared rules around screens?",
  "How will we respond to big feelings and meltdowns?",
  "How do we handle a rule being broken?",
  "What should homework and reading time look like?",
  "Which chores are appropriate, and how do we encourage effort?",
  "How do we talk about the other home?",
  "How do we prepare for a calm handoff?",
  "What do we want to keep consistent around meals?",
  "How will we revisit an agreement that isn't working?",
];
export const emptyHub = (): HubState => ({
  photos: [],
  resources: [],
  contacts: [],
  messages: [],
  exercises: [],
  goals: [],
  recognitions: [],
  redemptions: [],
  profiles: {},
  requests: {},
});
