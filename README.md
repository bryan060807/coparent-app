# Two Homes

A private, mobile-first school-paper handoff for a fictional six-year-old, Casey Willow. Built with Next.js, TypeScript, and SQLite (Node's built-in `node:sqlite`). No external services or API keys are needed. Scheduling, homework, notifications, OCR, and deployment are intentionally out of scope.

## Install and launch

Use **Node.js 24+** and npm. From the repository root:

```sh
npm ci
npm run seed
npm run dev
```

The development server listens on port 3000 and all interfaces. Use your browser to open the server on your development machine. For two physical phones, both must be able to reach that machine on a trusted local network; remote cloud access is environment-specific.

The seed is development-only, repeatable, and preserves existing records. It creates these fictional accounts:

| Parent          | Email               | Household |
| --------------- | ------------------- | --------- |
| Alex Willow (A) | alex@example.test   | Willow    |
| Sam Willow (B)  | sam@example.test    | Willow    |
| Jordan Cedar    | jordan@example.test | Cedar     |

All three use the demo password `Backpack-demo-26!`. These are local development credentials, not real family accounts. The seed creates no papers, so you can see the new-household empty state. Upload the included **`fixtures/permission-slip.pdf`**, a small fictional permission slip.

## Two-browser walkthrough

1. Sign in as Alex in one browser and Sam in a separate browser or private window (separate cookie storage).
2. Alex: Today → Add school paper. Enter **Field trip permission slip**, choose a due date, assign Sam, and select the sample PDF or a JPEG/PNG. Add paper.
3. Sam: without refreshing, the paper appears within about three seconds. Open it and choose **Open original attachment**. Mark **Signed**, with the note **In the blue folder.**
4. Both parents still see the paper on Today, labeled **Signed · return to school**. Either parent can open it and mark **Returned** once it has gone back to school.
5. It leaves Today and appears in History. Open it to see the chronological, named and timestamped Added → Signed → Returned timeline. Times display in the browser's local timezone; due dates are date-only.
6. In a third isolated browser session, sign in as Jordan. The Willow papers are absent. Known paper, timeline, and attachment URLs return 404; anonymous API requests return 401.

## Verification

```sh
npm run build
npm run typecheck
npm test
```

`npm test` requires the production build above. It starts its own server on port **3217**, seeds an isolated temporary SQLite database, runs API and browser checks, restarts the server to verify persistence, and deletes its temporary data. It never resets your development database. Ensure port 3217 is free.

Browser checks use the installed `/usr/bin/chromium` when available. Otherwise install Playwright's browser once with `npx playwright install chromium` (on Linux, system libraries may also be needed with `npx playwright install --with-deps chromium`). Set `CHROMIUM_PATH` to an alternative installed Chromium executable if needed. Network policy must permit the browser download if none is installed.

Coverage includes two independent authenticated browser contexts at a 390px phone viewport, live cross-session updates without reload, upload errors retaining text/date fields, the full handoff/history, original PDF bytes, third-household and anonymous access to direct URLs, assignee membership, actor spoofing, invalid files/dates, oversized files, repeated uploads, concurrent duplicate signing, stale updates, CSRF rejection, and data/session/attachment persistence after restart.

Physical-phone camera/file-picker behavior, iOS/Android PDF viewing, keyboard layout, and real-device network reconnects still need hands-on verification. JPEG, PNG, and PDF are supported; HEIC must be exported to JPEG. Signing records a parent's confirmation that the physical paper was signed; it does not edit or electronically sign the attachment.

## Storage and access model

- `data/family.sqlite` stores users, hashed passwords, expiring sessions, papers, and events. `data/attachments/` stores random-named private originals outside `public/`. Both are ignored by Git and persist across app restarts. Back up the entire data directory together. Override its location with an absolute `DATA_DIR` if desired, using the same setting for seed and server.
- Every API request authenticates the session; every individual paper, timeline, attachment, and mutation query verifies household membership server-side. The actor comes exclusively from the session. Parents may sign or return a paper within their own household; the assignee indicates responsibility, not exclusive permission.
- SQLite transactions and a unique event constraint prevent duplicate status events. Returned is final. Returning an unsigned paper is rejected. Retried creation uses an idempotency key. No public attachment routes exist.
- Uploads are limited to 10 MiB, with a bounded multipart request, MIME and file-signature checks. Originals are served with private/no-store caching, nosniff and sandbox headers. This is format validation, not antivirus scanning.
- Session cookies are HTTP-only, SameSite Strict, and expire after seven days. Mutations reject cross-origin requests. Local HTTP works by default; set `COOKIE_SECURE=true` when running behind HTTPS. Seed credentials and local HTTP are for development. Public deployment and production identity onboarding are separate future work.

For a local production-mode run after seeding: `npm run build` then `npm start`. No background worker or additional database process is required.
