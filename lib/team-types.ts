export const APP_NAME = "Team";
export const DEFAULT_CHILD_NAME = "Bill";
export const teamName = (name: string) => `Team ${name}`;
export type Team = {
  childName: string;
  name: string;
  version: number;
  updatedBy: string | null;
  updatedAt: string | null;
};
export function personalName(value: unknown, limit: number): string | null {
  if (typeof value !== "string" || value.length > limit * 3) return null;
  const name = value.normalize("NFC").trim().replace(/ +/g, " ");
  return name.length > 0 &&
    name.length <= limit &&
    !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(name)
    ? name
    : null;
}
