import type { SVGProps } from "react";
import { APP_NAME } from "../lib/team-types";
export type IconName =
  | "today"
  | "pickups"
  | "homework"
  | "more"
  | "gifts"
  | "routines"
  | "info"
  | "history"
  | "paper"
  | "logout"
  | "team";
const paths: Record<IconName, React.ReactNode> = {
  team: (
    <>
      <circle cx="9" cy="7" r="3" />
      <path d="M3 21v-3a6 6 0 0 1 12 0v3m1-17a3 3 0 0 1 0 6m3 11v-3a6 6 0 0 0-3-5" />
    </>
  ),
  today: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" />
    </>
  ),
  pickups: (
    <>
      <path d="M4 10h16l-2-5H6l-2 5Zm0 0v8m16-8v8M7 18h10M7 13h.01M17 13h.01M3 18h3m12 0h3" />
      <path d="M6 18v2m12-2v2" />
    </>
  ),
  homework: (
    <>
      <path d="M12 6v15M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2V4Z" />
      <path d="M6 8h3m6 0h3M6 12h3m6 0h3" />
    </>
  ),
  more: (
    <>
      <rect x="3" y="3" width="6" height="6" rx="1.5" />
      <rect x="15" y="3" width="6" height="6" rx="1.5" />
      <rect x="3" y="15" width="6" height="6" rx="1.5" />
      <rect x="15" y="15" width="6" height="6" rx="1.5" />
    </>
  ),
  gifts: (
    <>
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M5 12v9h14v-9M12 8v13" />
      <path d="M12 8c-7 0-7-7-3-5 2 1 3 5 3 5Zm0 0c7 0 7-7 3-5-2 1-3 5-3 5Z" />
    </>
  ),
  routines: (
    <>
      <path d="M9 5h12M9 12h12M9 19h12M3 5l1 1 2-3M3 12l1 1 2-3M3 19l1 1 2-3" />
    </>
  ),
  info: (
    <>
      <path d="M12 21S3 16 3 9a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 7-9 12-9 12Z" />
      <path d="M9 12h6m-3-3v6" />
    </>
  ),
  history: (
    <>
      <path d="M4 6v5h5M4 11a8 8 0 1 1 1 7" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  paper: (
    <>
      <path d="M6 3h8l4 4v14H6V3Z" />
      <path d="M14 3v5h4M9 12h6m-6 4h4" />
    </>
  ),
  logout: (
    <>
      <path d="M10 4H4v16h6m4-12 4 4-4 4m-6-4h10" />
    </>
  ),
};
export function Icon({
  name,
  ...props
}: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
export function Brand({ name = APP_NAME }: { name?: string }) {
  return (
    <div className="brand">
      <svg
        className="brand-mark"
        viewBox="0 0 48 48"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth=".8" />
        <circle
          cx="24"
          cy="24"
          r="18.5"
          stroke="currentColor"
          strokeWidth=".5"
          strokeDasharray="1 4"
        />
        <path
          d="m11 24 8-7 8 7m-14-2v11h12V22m-3-3 7-6 8 7m-12-3v16h10V18M18 28v5m12-9v9"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div>
        <strong>{name}</strong>
        <span>Family, well prepared.</span>
      </div>
    </div>
  );
}
export function PrepIllustration() {
  return (
    <svg
      className="prep-illustration"
      viewBox="0 0 320 150"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="233" cy="77" r="58" stroke="currentColor" strokeWidth=".8" />
      <circle cx="233" cy="77" r="48" stroke="currentColor" strokeWidth=".5" />
      <g transform="rotate(-8 107 78)">
        <path
          d="M40 15h124v122l-7-4-7 4-7-4-7 4-7-4-7 4-7-4-7 4-7-4-7 4-7-4-7 4-7-4-7 4-7-4-7 4-7-4-7 4V15Z"
          fill="#f4ecda"
        />
        <path
          d="M55 35h49m-49 8h33M76 65h64m-64 22h64m-64 22h41"
          stroke="#58694e"
          strokeWidth="1.5"
        />
        <path
          d="m55 63 4 4 7-9m-11 27 4 4 7-9"
          stroke="#58694e"
          strokeWidth="1.7"
        />
        <rect x="55" y="103" width="10" height="10" rx="1" stroke="#a88b57" />
        <path
          d="M130 10h14v16c0 9-14 9-14 0V10Z"
          stroke="#c2a469"
          strokeWidth="2"
        />
      </g>
      <path
        d="M197 121c20-25 29-48 30-76m-13 47c-23 0-24-18-24-18s21 0 24 18Zm7-18c-9-16 6-29 6-29s9 18-6 29Zm-15 30c20 4 30-12 30-12s-22-5-30 12Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function EmptyMark() {
  return (
    <svg
      className="empty-mark"
      viewBox="0 0 80 72"
      fill="none"
      aria-hidden="true"
    >
      <ellipse
        cx="40"
        cy="37"
        rx="34"
        ry="31"
        fill="currentColor"
        opacity=".08"
      />
      <rect
        x="23"
        y="10"
        width="34"
        height="50"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M31 7h18v7H31V7Z"
        fill="var(--paper)"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="m30 29 3 3 5-6m4 3h8m-20 13 3 3 5-6m4 3h8"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M18 66h44" stroke="currentColor" strokeWidth=".8" />
    </svg>
  );
}
