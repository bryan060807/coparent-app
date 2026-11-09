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

### Family finances

Open **More → Family finances**. This parent-only space is separate from the child’s **Gifts & money** log.

- **Expenses:** record a title, category (school, medical, travel, activities, other), date, notes, amount, and who paid. The default split is 50/50; custom USD shares support 100/0. An extra cent goes to the first listed parent, shown before saving. Both parents can edit or void expenses; versions protect stale drafts and the activity retains earlier details. Voided records remain visible but leave totals.
- **Payments:** each parent enters **their own PayPal.Me username** (the part after `paypal.me/`) in **My PayPal**; the app builds the full link. Pasting a full PayPal.Me link also works. The owing parent prepares a reimbursement or an unrelated transfer, opens PayPal, verifies the recipient/amount there, then chooses **I sent this money** after paying. Only the recipient can choose **I received…**. Opening a link never sends money or changes status. Cash/bank/other methods can be recorded too. Only received reimbursements settle shared expenses; other money stays separate. Pending reimbursements reserve their amount to discourage paying twice. A changed recipient link invalidates prepared PayPal handoffs. A recipient can report nonreceipt, then confirm later or close the unreceived record with a reason. Confirmed receipts remain final; corrections require a separate record. The app does not verify payments with PayPal, hold funds, handle fees/disputes, or need PayPal/Stripe API keys.
- **Savings:** create editable college, trip, medical, emergency, or custom-purpose goals with a USD target, optional target date, and a written plan. Record deposits/withdrawals made outside the app, see progress and contribution history, and archive/restore goals. Each parent can void only their own entry with a reason. Concurrent withdrawals cannot make recorded savings negative. These are manual records, not linked accounts or investment balances.

Amounts use integer USD cents. Every change records the signed-in parent and server time. The two sessions poll every three seconds. Finance data is excluded from the general hub response, denied to child accounts, and protected on direct record/activity/PayPal URLs. It persists in the existing private household store on SQLite or Supabase. **No new migration, dependency, environment variable, or DNS change is needed** if the earlier family-hub migration is already applied.

Two-browser walkthrough (fictional local accounts above):

1. Sign in as Alex in one browser and Sam in another. Open Family finances in each. Alex saves a fictional PayPal.Me handle (do not send a test payment to a real account).
2. Alex adds a $100.01 school-trip expense, paid by Alex, with the default split. Sam sees $50.00 owed without refreshing.
3. Sam prepares a $20.00 reimbursement. For a real family account, check the PayPal recipient/amount and complete payment there. For fictional testing, inspect the handoff only and simulate **I sent this money**. Opening PayPal alone leaves the record ready to send.
4. Alex confirms receipt. Sam’s balance becomes $30.00 owed. Check Activity in both sessions. Try editing the same expense in both browsers to see stale-draft protection.
5. Create a college goal and record a $100 deposit. Both parents see its contribution history. The child and the separate Cedar household cannot access these records.

```sh
npm run build
npm run typecheck
npm run test:finance
```

`test:finance` runs exact-cent/domain checks plus independent parent, child, third-household, and anonymous Chromium sessions against SQLite (**3362**) and the Supabase SDK with a Postgres/Auth fixture (**3363**). It exercises the screens, receipt workflow, retry races, stale edits, safe redirects, link changes, savings withdrawal races, access restrictions, mobile widths, and persistence across restart. It never sends money or contacts PayPal. A real PayPal handoff, provider login/fees, and physical-phone browser behavior still need hands-on verification.

### App settings and family location

**My profile** now edits identity only: display name, avatar, and bio. **App settings** is a separate page with eight themes (including After hours), six locally bundled fonts, seven background patterns or a private gallery photo, a photo-readability overlay, four text sizes, compact/comfortable spacing, three card styles, high contrast, reduced motion, 12/24-hour time, a startup page, and Today summary visibility. A preview shows the selected font and card treatment. Changes save to the account and preserve stale drafts. Profile edits cannot reset appearance settings.

Parents have a **Child defaults** tab. Its look and behavior apply to a new child profile or whenever the child chooses **Use my team's defaults**. Personal child choices remain independent. Child defaults can use only photos explicitly shared with the child. **My profile** and **Make this space mine** are separate actions in the child view.

**More → Family map** provides voluntary location sharing. Each device starts with sharing off. On the device you want to share, choose a duration (**1, 8, or 24 hours**), check the consent box, press **Start sharing my location**, and allow the browser's location prompt. For the child, a parent must first enable **App settings → Child defaults → Allow the child account to share its device location with parents**; the child's device still has to opt in. Parents see both parents and the child in their own household. Children can manage their own sharing but cannot read the parent map or other people's points, including through direct API requests.

The app reports device positions while open about once every 30 seconds, with substantially better accuracy fixes sent promptly, and checks sharing status about every 15 seconds. A visible banner includes Stop. The map shows capture time, GPS accuracy, and a **Last known · may be out of date** label after two minutes without a fresh fix. Closing the app, signing out, sleeping, losing connectivity, or powering off the phone can stop updates; its previous point stays visible until the sharing period ends or sharing is stopped. The browser cannot wake an unreachable phone or provide dependable background tracking. Verify actual iOS/Android behavior before relying on it.

**Stop sharing** immediately stops this device's GPS watcher and asks the server to remove its saved point. If disconnected, the app explicitly says the server may still retain that point and offers retry; it does not resume collecting automatically. Expired sessions, a disabled child account, a child password reset, or revoked guardian permission invalidate child sharing. Only the latest point is stored, not a route history. Expired/revoked saved points are removed on the next authenticated household request. The data uses the existing private household store with RLS; it is never included in the general hub response or publicly accessible.

**Location accuracy:** phones with precise location enabled generally give better positions than laptops. A laptop often relies on Wi-Fi/IP estimates and may report another city. Browser accuracy is an estimate, not a guarantee. The UI labels broad fixes as approximate areas and shows their radius; the map initially fits that area rather than zooming tightly into a pin. A recent accurate fix is retained against a much worse fallback for up to 60 seconds without changing its original capture time; after that a fresh approximate fix may replace it. A substantially more accurate fix bypasses the usual send interval. No coordinates are corrected or inferred by the app. This improves reporting, but cannot add GPS to a laptop.

Press **Load family map** to load OpenStreetMap tiles with attribution. The tile provider sees the area being viewed. **Open this point in Maps** sends that selected point to Google Maps only when clicked. Neither feature needs a new API key. New settings and location use the existing schema: no additional Supabase migration, Vercel variable, or DNS change is required for this release.

```sh
npm run build
npm run typecheck
npm run test:settings
```

`test:settings` runs domain checks and independent parent/child/third-household/anonymous browser sessions against SQLite and the Supabase SDK/Postgres fixture on ports **3360/3361**. GPS is simulated at fictional test positions and map tiles are intercepted. Coverage includes separate profile/settings pages, preference isolation and stale drafts, child defaults/overrides, startup pages, explicit GPS opt-in, parent-only map access, stale timestamps, offline Stop, pause/update races, guardian revocation, and restart persistence. Real phone permissions, GPS accuracy, background/sleep behavior, offline reconnects, and live tile delivery still need physical-device checks.

### Family hub release

**More** now includes **Photo gallery**, **Resources**, **Parenting together**, **Parent chat**, **Contacts**, **Stars & rewards**, **My profile**, and **App settings**. These features work with either local SQLite or hosted Supabase. For an existing hosted installation, apply the additional migration described in [DEPLOYMENT.md](DEPLOYMENT.md#upgrading-an-existing-team-bill-installation) before deploying this release.

- **Gallery:** add private JPEG/PNG photos up to 10 MiB, captions, and an explicit **Show in child view** setting. Open originals, edit captions/sharing, or remove an item from the gallery. Rejected files preserve the caption. Originals have authenticated download URLs and private/no-store responses. HEIC needs exporting to JPEG. Removing an item revokes its app URL; private unreferenced originals are retained for administrative cleanup rather than permanently erased.
- **Resources:** save your own HTTPS links and/or written guidance, for parents only or for parents and child. No public directory or automatic external content fetch is involved.
- **Parenting together:** choose a question (bedtime, screens, big feelings, and more), or ask your own. Each parent owns their answer. Write a shared approach and have both parents explicitly agree. Changing an answer or plan clears earlier approvals. This is a conversation exercise, not generated advice.
- **Parent chat:** an AOL-inspired private conversation with named, timestamped messages. It polls every three seconds, keeps unsent drafts after errors, prevents duplicate retries, and offers earlier messages once the latest 200 are shown. Messages are persisted; this version does not edit or delete sent messages or send push notifications.
- **Contacts:** edit shared names, relationships/roles, phone numbers, email addresses, notes, important-contact pins, and child visibility. Phone/email links open the device's calling/mail app. Contacts start empty; all test numbers and addresses are fictional.
- **Stars & rewards:** each completed **chore** earns **one star per task/calendar day**, including existing recorded chore checkoffs when upgrading. Routines do not earn stars. Undoing a checkoff reverses its star; repeating/checking again cannot multiply awards. Parents can add recognition with zero to 100 extra stars, define/edit/archive goals, and approve or decline requests. Only approval spends stars. Concurrent approvals cannot overspend; goal title/cost are captured when requested. If a spent chore star is later reversed, approved rewards stay approved and future earnings first cover the difference. The child sees a minimum balance of zero.
- **Profiles/settings:** edit your own name, emoji avatar, short bio, theme, font, background, larger text, and reduced motion. Themes are Herb garden, Blue skies, Peachy days, and Berry bright. The default font is locally bundled Nunito; DM Sans and the original Newsreader style remain choices. Backgrounds can be plain, confetti, waves, or an accessible gallery photo. Preferences persist per account, across sessions. The app sends no font or wallpaper requests to third parties.

**Separate child login:** a parent opens **More → Stars & rewards → Set up child login**, chooses a globally unique username (4–40 letters/numbers/underscores/hyphens), and sets a password of 12–200 characters. No child email is required. On the signed-out screen choose **Child sign in**. The child sees today's routines/checkoffs, stars, recognition, rewards, and explicitly shared photos/resources/contacts, and can request a reward or personalize their space. A parent checks off chores; children cannot self-award stars or approve rewards. Parent chat, parenting exercises, money, health records, school papers, pickups, homework details, invitations, and parent settings are denied server-side even through known API URLs. Child passwords are salted/scrypt-hashed; only hashed session tokens are stored. Resetting or disabling the child account revokes existing child sessions. Child sign-in on a parent browser signs out the parent; sign out of the child account before a parent signs back in.

Run the additional integration checks after building:

```sh
npm run test:hub
```

They run independent parent, child, third-household, and anonymous sessions against SQLite and against the real Supabase SDK with Postgres/RLS and an Auth/Storage HTTP fixture. They cover editable/stale contact forms, private photos and rejected uploads, resource audiences, chat sync/idempotency, separate exercise answers/approvals, child API boundaries, automatic star reversals, reward approval races, appearance isolation, password-reset revocation, persistence, and 320px layouts. Ports **3356/3357** must be free. They do not contact live providers. Keep `npm test` and `npm run test:cloud` for the earlier workflows. On physical phones, still check camera/gallery permissions, call links, email confirmation delivery, keyboards, and original-image viewing.

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
