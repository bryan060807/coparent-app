# Team · Their name. Your team.

For hosted parent testing with **Supabase + Vercel + Cloudflare**, see [DEPLOYMENT.md](DEPLOYMENT.md). The local SQLite setup below remains available. Hosted accounts, records, and attachments live in Supabase; local data is not automatically uploaded.

A private, mobile-first app named after the child at its heart: **Team Bill**, Team Maya, or the name/nickname your family chooses. Both parents are on the same team, across two homes. The app handles school papers, pickup plans, homework, gifts and money, routines and chores, and shared health/personal notes. Fictional examples use six-year-old Bill Willow. Built with Next.js, TypeScript, and SQLite (Node's built-in `node:sqlite`). No external services or API keys are needed. Repeating pickup/custody schedules, notifications, OCR, a combined household timeline, and deployment remain out of scope.

The interface takes its visual cues from a chef's prep notebook: warm paper, forest green, restrained brass accents, editorial headings, and clear checklists. Plain feature labels, large controls, sticky navigation, visible keyboard focus, and reduced-motion support keep it practical. DM Sans and Newsreader fonts are bundled locally; the app makes no requests to a font service.

## Install and launch

Use **Node.js 24+** and npm. From the repository root:

```sh
npm ci
npm run dev
```

For an existing checkout, stop the server, run `git pull --ff-only origin main`, then `npm ci` and `npm run dev`. The visual update adds bundled font dependencies. No reseeding is needed; existing accounts, records, and attachments stay in place. In Windows PowerShell, use `npm.cmd` if the execution policy blocks `npm`.

The development server listens on port 3000 and all interfaces. If 3000 is occupied, Next chooses another port (such as 3001); use the **Local** address printed in the terminal. Open `localhost` on that computer, not the `0.0.0.0` bind address. For two physical phones, both must be able to reach that machine on a trusted local network; remote cloud access is environment-specific. Next's development assets allow this computer's local interface addresses without allowing arbitrary external origins. Restart the dev server after changing networks.

Choose **Create an account** to start your own team; no seed command is needed. To try fictional demo accounts instead, run `npm run seed` from another terminal. The seed is development-only, repeatable, and preserves existing records and custom team names. It creates these fictional accounts:

| Parent          | Email               | Household |
| --------------- | ------------------- | --------- |
| Alex Willow (A) | alex@example.test   | Willow    |
| Sam Willow (B)  | sam@example.test    | Willow    |
| Jordan Cedar    | jordan@example.test | Cedar     |

All three use the demo password `Backpack-demo-26!`. These are local development credentials, not real family accounts. The seed creates no papers, so you can see the new-household empty state. Upload the included **`fixtures/permission-slip.pdf`**, a small fictional permission slip.

## Accounts, invitations, and your team name

1. Choose **Create an account**, enter your name, email, and a password of **12–200 characters**, then choose **Create a team**. Enter your child's name or nickname. **Bill** becomes **Team Bill**; the preview explains the idea before you save.
2. You are signed in to a new, empty household. Choose **Invite the other parent** on Today, or **More → Your team → Create invitation**. Share the code privately yourself; the app does not send an email.
3. In a separate browser session, the other parent chooses **Create an account → Join the other parent’s team**, enters their own name/email/password, and pastes the code. Both accounts now share the same household. A code is valid once for **72 hours**; creating another invalidates any unused code. Joining and claiming the second place happen in one transaction. Teams hold two parents.
4. Either parent can open **More → Your team** and edit **Child's name or nickname**. The **“Their name. Your team.”** explanation and live preview make naming part of the app's character. Names support spaces, accents, and other scripts, up to 40 characters. Changes appear in both parents' headers and browser titles within about three seconds. Stale edits keep the draft and require explicitly loading the current name.
5. Sign out and return using your own email and password. Email addresses are case-insensitive. Existing fictional accounts and their records continue to work; no reset/reseed is required. A legacy household without a saved team name starts as **Team Bill** until either parent changes it. Newly seeded Willow/Cedar teams use Bill/Robin.

Passwords are salted and hashed with scrypt. New session tokens and invitation codes are stored as hashes, with HTTP-only session cookies. Sign-in and signup attempts are limited per email address; excessive attempts return 429 for up to 15 minutes. The server derives household membership and actor identity from the authenticated session, never a submitted household/user ID. Public sign-in pages use the neutral **Team** brand; a household's custom name is fetched only after authentication, and cleared on sign-out/account switching.

Email is the login identifier. Email ownership verification, password recovery, and outbound email are not connected to a mail service in this build. Keep credentials somewhere you can recover them. Real-device network access and public deployment are separate setup tasks.

## Two-browser walkthrough

1. Sign in as Alex in one browser and Sam in a separate browser or private window (separate cookie storage).
2. Alex: Today → Add school paper. Enter **Field trip permission slip**, choose a due date, assign Sam, and select the sample PDF or a JPEG/PNG. Add paper.
3. Sam: without refreshing, the paper appears within about three seconds. Open it and choose **Open original attachment**. Mark **Signed**, with the note **In the blue folder.**
4. Both parents still see the paper on Today, labeled **Signed · return to school**. Either parent can open it and mark **Returned** once it has gone back to school.
5. It leaves Today and appears under **More → Paper history**. Open it to see the chronological, named and timestamped Added → Signed → Returned timeline. Times display in the browser's local timezone; due dates are date-only.
6. In a third isolated browser session, sign in as Jordan. The Willow papers are absent. Known paper, timeline, and attachment URLs return 404; anonymous API requests return 401.

## Shared pickups walkthrough

1. Alex: choose **Pickups → Add pickup**. Enter **School pickup**, a date and time, **Willow Primary, front gate**, assign Sam, and optionally add **Bring the blue folder**.
2. Sam: Today shows the next pickup within about three seconds. Choose **View pickups**, then open the pickup. Both parents see the time, location, responsible parent, and note.
3. Either parent can **Edit pickup** to reschedule, change the location, reassign responsibility, or update the note. Changes sync automatically, including when the other parent already has the pickup open. Activity keeps named, timestamped snapshots of each change.
4. After the handoff, choose **Mark picked up → Confirm picked up**. It leaves Upcoming and Today, and remains under **Past pickups**. To cancel a plan instead, choose **Cancel pickup → Confirm cancellation**. Completed and cancelled records cannot be edited or reopened.
5. If both parents edit at once, the older draft cannot overwrite the newer version. The draft stays visible alongside the current details; **Discard my draft and load latest details** explicitly replaces it. Retrying a saved operation does not duplicate its activity.
6. Jordan's separate household cannot list or open these pickups, read their activity, or modify them through known API IDs. Anonymous requests also require sign-in.

These are individual pickups, not a repeating custody calendar. Upcoming lists scheduled pickups earliest first, including past times that still need checking off or cancelling. Today highlights the earliest unresolved pickup. Enter times in the browser's displayed local time zone; instants are stored in UTC, and another time zone displays the equivalent local time. Nonexistent times during the spring clock change are rejected. Pickup responsibility is shared information: either household parent may edit, complete, or cancel a plan, with their own identity recorded.

New pickup tables are created automatically without deleting accounts, school papers, or attachments. No new seed/reset command is required; a new household starts with no pickups.

## Homework walkthrough

1. Alex: **Homework → Add homework**. Enter **Reading and math sheet**, a due date, and the optional note **Math sheet is in the blue folder**. Both parents see it as **Not started**; unfinished assignments also appear on Today, overdue and soonest-due first.
2. Sam: open the assignment from Today. Enter **Reading finished; math sheet is in the blue folder**, then choose **Start homework**. The status becomes **In progress** and Alex sees the note without refreshing.
3. Either parent can **Save handoff note** without changing progress, or **Edit assignment** to change its title, due date, and note. Unsaved drafts stay intact if the other parent changes the assignment; review the latest information before replacing a draft. Notes are limited to 500 characters; assignment titles to 160.
4. When the work is finished, enter a final note and choose **Mark done**. It leaves Today and To do, but remains under **Completed homework** with the named, timestamped activity and earlier notes. Done is final in this version: stale screens cannot reopen or change a finished assignment. Progress moves from Not started to In progress to Done.
5. Jordan's household cannot list, open, update, or read the activity of Willow homework, including known `/api/homework/{id}` and `/api/homework/{id}/timeline` URLs. Anonymous API requests require sign-in too.

Due dates are date-only values: switching time zones does not shift an assignment to a different due date. Work and notes sync about every three seconds. As with pickups, the new tables are added automatically on restart; existing accounts, papers, pickups, and attachments are retained. No reseeding is needed for an existing checkout.

## Gifts, money, routines, and family info

The compact main navigation is **Today / Pickups / Homework / More**. Under **More**, open **Gifts & money**, **Routines & chores**, **Health & personal info**, **Paper history**, or **Your team**. Both household parents can add and edit family records. The record sections sync about every three seconds, record named activity, preserve stale edit drafts instead of overwriting newer changes, and support **Archive record / Restore record**. Archives retain earlier details and activity; these controls do not permanently erase records.

**Gifts & money:** add a Gift, Money received, or Money spent, with a title, date, giver/payee, occasion, optional note, and thank-you status. Use **Edit record** to correct any field or record a sent thank-you. Monetary amounts use USD integer cents, up to $1,000,000 per entry, avoiding floating-point rounding. The recorded cash balance is received minus spent across active money entries. Gift values are optional and excluded from cash totals; archived entries are also excluded. Negative recorded balances are allowed when the log is incomplete. These are manual records; no payments or bank connections are involved.

Try Alex recording **Birthday money**, **Money received**, **Aunt Rowan**, **Birthday**, **50.00**. Sam should see $50 received without refreshing. Sam can edit it to $55 and mark the thank-you sent. Record a **Money spent** entry for **Book purchase**, **12.34**, and the recorded balance becomes **$42.66**. Archiving and restoring that purchase updates the totals accordingly.

**Routines & chores:** add your own task name and choose Routine or Chore. Repeat every day or on selected weekdays, choose an optional time, write instructions, and apply it to both homes or a specific parent's home. **Today** shows scheduled tasks; **All tasks** lets you find and edit other schedules; **Archived** holds removed tasks. Checkoffs are shared between both parents and keyed by task and calendar date. They start unchecked on a new day while previous dates remain in history. Either parent can undo today's checkoff. A specific-home filter also includes tasks that apply to both homes. Today’s dashboard shows a checklist summary when there are scheduled tasks.

Routine times and checkoff days use one shared time zone, initially **America/Chicago**. **Edit time zone** accepts a valid IANA name such as **America/Denver**. The displayed checklist date comes from the server in that zone, so phones in different zones still share the same daily checklist. Changing the zone changes which calendar day is current; existing history keeps its recorded dates, and activity retains the time zone used for each checkoff. A stale day, time-zone setting, task definition, or checkbox version cannot overwrite a newer checkoff. Recent checkoffs shows the latest 30 recorded dates; full named activity remains on the record.

Try Alex adding **Brush teeth**, every day at **07:30**, both homes. Sam can check it off, and Alex sees the check mark automatically. Add **Put toys away** as a chore on selected weekdays, then edit its schedule, instructions, or home. All task names and instructions are user-editable; no hard-coded child routine is required.

**Health & personal info:** add titled info cards in Health, Personal, Emergency contacts, School, or Other. Titles and free-form details are editable, and **Mark as important** brings a card to the top of its category/list. Use cards for allergies, medications or clinician-provided instructions, doctor and emergency contacts, birthdays, school details, clothing sizes, preferences, or any other information both homes need. Details support up to 4,000 characters and preserve line breaks. New households start empty; no medical facts are invented or seeded. Health details appear inside their household section, rather than on the Today dashboard.

All three sections are household-shared. The separate Cedar account and anonymous requests cannot list, open, update, or read activity through known `/api/family/{gifts|routines|info}/{id}` URLs or their `/timeline` endpoints. An account switch in another tab clears the previous account's screen and cached section data on the next authentication poll. These notes and their history are stored as plaintext in the local SQLite database, protected by filesystem permissions and server-side account/household checks. The app remains a local development build with fictional demo credentials.

## Verification

```sh
npm run build
npm run typecheck
npm test
npm run test:dev
```

`npm test` requires the production build above. It starts its own server on port **3217**, seeds an isolated temporary SQLite database, runs API and browser checks, restarts the server to verify persistence, and deletes its temporary data. `npm run test:dev` repeats the same checks using the development server and the same `--hostname 0.0.0.0` option as `npm run dev`. Run the suites sequentially and stop your dev server before `test:dev` so its build directory is available. Neither suite resets your development database. Ensure port 3217 is free.

`npm test` first runs SQLite startup regressions against temporary databases: brief and persistent locks, concurrent processes, preservation of existing records, and connection reuse across development reloads. Run just these checks with `npm run test:db`; they do not need a build or browser.

Browser checks use the installed `/usr/bin/chromium` when available. Otherwise install Playwright's browser once with `npx playwright install chromium` (on Linux, system libraries may also be needed with `npx playwright install --with-deps chromium`). Set `CHROMIUM_PATH` to an alternative installed Chromium executable if needed. Network policy must permit the browser download if none is installed.

Coverage includes two independent authenticated browser contexts at a 390px phone viewport, live cross-session updates without reload, upload errors retaining text/date fields, the full handoff/history, original PDF bytes, third-household and anonymous access to direct URLs, assignee membership, actor spoofing, invalid files/dates, oversized files, repeated uploads, concurrent duplicate signing, stale updates, CSRF rejection, and data/session/attachment persistence after restart.

Pickup checks also cover create/edit/reassignment/completion/cancellation, automatic Today updates, Chicago/Denver time-zone conversion, stale draft preservation, immutable final states, idempotent retries, concurrent updates, chronological ordering, household boundaries on direct pickup/activity URLs, and pickup persistence alongside existing school papers after restart.

Homework checks cover assignment creation, edited due dates, shared notes, all three progress states, automatic Today updates, completed history, invalid dates and note lengths, duplicate/concurrent requests, stale draft preservation, date-only behavior in Chicago/Denver, household and anonymous isolation, restart persistence, and navigation at 320px and 390px widths. The school-paper, pickup, and database-lock regressions continue to run.

Family-section checks cover integer cash totals, gift value exclusion, thank-yous, archive/restore effects, custom daily/weekly chores, daily reset with preserved prior checkoffs, time-zone changes and stale checkbox protection, checkoff rollback after rejection, home filters, editable/pinned health and personal cards, conflict draft preservation, direct-URL household isolation, account-switch cache clearing, restart persistence, and the More menu at both mobile widths.

Authentication regressions cover browser sign-in at localhost and `127.0.0.1`, session cookies surviving reload, sign-out, the actual request port, simulated LAN Host/Origin headers, and rejection of different origins, ports, schemes, and spoofed forwarded hosts. Development tests also verify that local-IP dev assets are allowed while external origins remain blocked. Physical-phone access still requires a reachable Windows host; these tests do not establish phone connectivity.

Account/team checks cover self-service signup, case-insensitive login, hashed passwords and session tokens, older-session compatibility, rate limits, invitation replacement/expiry/single use and simultaneous claims, the two-parent limit, household name privacy, actor/household spoofing, duplicate/stale renames, restart persistence, error drafts, account-switch/sign-out clearing, and long Unicode names at a 320px phone viewport. Two independent browser sessions create accounts and join the same team through the actual screens.

Before sign-in, a 401 response from `/api/me` is expected. Repeated 403 responses from `/api/login` are not: update the app and restart the dev server. When using local HTTP, leave `COOKIE_SECURE` unset or `false`; `true` requires HTTPS and can prevent the browser from retaining its session on an HTTP address. Seeding again is safe and does not remove papers or uploads.

If `/api/me` returns **500** and the terminal says **database is locked/busy**, stop the app with Ctrl+C (answer Y to Windows' batch-job prompt). Stop any other copy of this app running against the same data directory, and close database editors holding write transactions. Pull the latest update and start one server. Startup now waits for brief locks, reuses one connection across development reloads, and closes failed connections without resetting data. Persistent locks produce an actionable terminal error after a bounded wait. Do not delete `data/`, the SQLite database, or its WAL/SHM files to clear a lock.

Physical-phone camera/file-picker behavior, iOS/Android PDF viewing, keyboard layout, and real-device network reconnects still need hands-on verification. JPEG, PNG, and PDF are supported; HEIC must be exported to JPEG. Signing records a parent's confirmation that the physical paper was signed; it does not edit or electronically sign the attachment.

## Storage and access model

- `data/family.sqlite` stores users, hashed passwords, expiring sessions, papers, and events. `data/attachments/` stores random-named private originals outside `public/`. Both are ignored by Git and persist across app restarts. Back up the entire data directory together. Override its location with an absolute `DATA_DIR` if desired, using the same setting for seed and server.
- Every API request authenticates the session; every individual paper, timeline, attachment, and mutation query verifies household membership server-side. The actor comes exclusively from the session. Parents may sign or return a paper within their own household; the assignee indicates responsibility, not exclusive permission.
- SQLite transactions and a unique event constraint prevent duplicate status events. Returned is final. Returning an unsigned paper is rejected. Retried creation uses an idempotency key. No public attachment routes exist.
- Pickups and their activity are in the same private SQLite database. Every pickup mutation requires a version and an idempotency key (creation needs only the key). Conflicts return 409 rather than silently replacing another parent's edits. Activity attributes changes to the signed-in parent and retains the plan details at each revision.
- Homework uses the same version checks, idempotency keys, server-owned actor identity, and household membership checks. Assignment and note edits preserve their earlier snapshots in private activity records. Finished assignments cannot move backward or be edited by stale clients.
- Uploads are limited to 10 MiB, with a bounded multipart request, MIME and file-signature checks. Originals are served with private/no-store caching, nosniff and sandbox headers. This is format validation, not antivirus scanning.
- Session cookies are HTTP-only, SameSite Strict, and expire after seven days. Sign-out revokes the current session. Existing sessions from earlier versions work until expiry; new sessions use hashed token storage. Mutations reject cross-origin requests. Local HTTP works by default; set `COOKIE_SECURE=true` when running behind HTTPS. Seed credentials and local HTTP are for development. Public deployment is separate future work.

For a local production-mode run: `npm run build` then `npm start`. Create an account in the browser, or seed fictional accounts before starting. No background worker or additional database process is required.
