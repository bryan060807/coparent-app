# Team Bill on Supabase, Vercel, and Cloudflare

Vercel runs Next.js. Supabase Auth owns hosted accounts, Postgres owns shared records, and the private `school-papers` Storage bucket holds originals. Cloudflare supplies DNS. The planned hostname is **teambill.aibrylabs.com**; `teambill@aibrylabs.com` would be an email address.

The selected targets are [Supabase project vytfpsxwrrfgrasbrdzd](https://supabase.com/dashboard/project/vytfpsxwrrfgrasbrdzd) (`https://vytfpsxwrrfgrasbrdzd.supabase.co`), [Vercel coparent-app](https://vercel.com/bryan060807s-projects/coparent-app), and the Cloudflare zone `aibrylabs.com`. The confirmed website hostname is `teambill.aibrylabs.com`.

## 1. Prepare the Supabase project

Use a dedicated project for the app. Run the complete [migration](supabase/migrations/202611070001_team.sql) once in its SQL Editor, or apply it with your normal Supabase migration workflow. The migration creates `app_*` tables/functions, row-level security, and the private Storage bucket. It does not import, change, or delete the local SQLite database. Existing local users/passwords and papers stay local; hosted parents create their own new accounts.

Under **Authentication → URL Configuration**, set:

- Site URL: `https://teambill.aibrylabs.com`
- Redirect URL: `https://teambill.aibrylabs.com/auth/callback`
- For an additional Vercel test URL, add its exact `/auth/callback` URL too.

Email/password authentication must be enabled. Set its minimum password length to 12 characters to match the app. The app supports both immediate signup and confirmed-email signup. With email confirmation enabled, configure an SMTP provider that can deliver to the parents' addresses; Supabase's built-in test mail service has recipient/rate restrictions. For a private alpha using the same password-only behavior as the current local app, confirmation can be disabled in the Supabase project's email-provider settings. The app still uses Supabase Auth and separate parent passwords. Once confirmation is enabled, the app displays the check-email step and finishes household setup after the PKCE callback or a later sign-in. Password recovery is not implemented yet.

Get the project API URL, publishable key (a legacy anon key also works), and server secret key (a legacy service-role key also works) from the project settings. Enter secret values directly in Vercel's Environment Variables panel or a secure local `.env.local`; do not paste them into chat or commit them. The server secret is used only to authorize staging uploads and validate private originals. Normal records and reads use the signed-in parent's JWT and database rules.

## 2. Configure Vercel

Import `bryan060807/coparent-app`, branch `main`, using the Next.js preset and **Node.js 24**. Keep the framework's normal output settings. Install with `npm ci`; build with `npm run build`.

Set these variables for the deployment you intend to test:

| Name                       | Value                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| `APP_BACKEND`              | `supabase`                                                                                |
| `APP_ORIGIN`               | `https://teambill.aibrylabs.com`                                                          |
| `SUPABASE_URL`             | Your project's HTTPS API URL                                                              |
| `SUPABASE_PUBLISHABLE_KEY` | Its publishable/anon key                                                                  |
| `SUPABASE_SECRET_KEY`      | Its server secret/service-role key; server only                                           |
| `APP_ALLOWED_ORIGINS`      | Optional exact additional origins, comma-separated, such as the stable Vercel project URL |

No Supabase secret uses a `NEXT_PUBLIC_` variable. The publishable key is public by design and is returned only with an authorized signed-upload response. Vercel requests fail closed if cloud configuration is missing; they never silently initialize SQLite or write local attachments. The Vercel deployment's own `VERCEL_URL` is also an allowed origin. Callback links use `APP_ORIGIN`, so make sure that hostname works before inviting parents to sign up.

Deploy/redeploy after setting variables. Test the Vercel URL before changing DNS. Do not run `next dev` on Vercel. No deployment requires `npm run seed`, and no demo accounts are created automatically.

## 3. Connect Cloudflare DNS

In **Vercel → Project → Settings → Domains**, add `teambill.aibrylabs.com`. In the Cloudflare zone for `aibrylabs.com`, create the record Vercel specifies. Usually this is a CNAME named `teambill`; copy the **exact target shown by Vercel**, since targets can vary by project. Start with **DNS only** (gray cloud). Add any verification TXT record Vercel explicitly requests, and wait for Vercel to report valid domain configuration and HTTPS certificate issuance.

Cloudflare stays the DNS provider. No transfer of the domain or nameserver changes are necessary. Avoid overwriting an existing hostname that serves another app. Do not enable a cache rule for `/api/*` or authenticated attachments; the app sends private/no-store headers.

## 4. Parent test and verification

1. Parent A opens the HTTPS hostname, chooses **Create an account → Create a team**, and enters **Bill**. If confirmation is enabled, finish the email step and team setup.
2. **More → Your team → Create invitation**. Share the code privately. Parent B creates a separate account and chooses **Join the other parent’s team**. Codes expire after 72 hours and work once.
3. Use the included fictional permission slip for the full Add → Signed ("In the blue folder.") → Returned handoff. Check automatic updates, original attachment access, and history in both sessions.
4. Create a third fictional household and confirm that a known paper/detail/timeline/download URL is denied there and when signed out. Also check gifts/money, routines, homework, and editable health/personal cards with fictional details.
5. Check a larger PDF above 4.5 MB on the actual Vercel deployment. Uploads go directly to a private staging URL, then a small API request finalizes them. Finalization checks size, MIME and magic bytes on the server before saving an immutable original. Downloads stream through the authenticated API; it never issues public or signed download URLs. The actual platform's large-file behavior must be verified after deployment.

Private staging URLs last up to two hours; upload intents last one hour. Rejected files are removed; failed/abandoned upload attempts can leave private staging objects that need periodic administrative cleanup. None are attached to a paper or readable through the parent download policy. Keep the Storage bucket private and retain the migration's database and Storage policies.

## Upgrading an existing Team Bill installation

The subsequent **App settings / Family map** update uses optional fields in the existing private hub store. After the two migrations below are installed, this update needs only a normal application deployment: **no further SQL migration or environment variables**. Location sharing starts off. Parents control whether the child may opt in; each device separately grants browser permission and a time-limited sharing consent. See README for foreground/browser limitations and verification. The map fetches public OpenStreetMap tiles only when a parent loads it; retain attribution. No provider secret is added to the client.

For the family hub release, run **only the new** [202611080001_family_hub.sql](supabase/migrations/202611080001_family_hub.sql) in the selected project's SQL Editor before deploying the updated application. The original `202611070001_team.sql` must already be installed; do not rerun it on an existing project. The new migration is additive and preserves parent accounts, households, papers, attachments, and existing records. Run it once, then deploy/redeploy the application from the updated Git revision. A new project needs both migrations in filename order.

The new tables store the household hub, hashed child sessions, sign-in limits, and a chore-star ledger. RLS is enabled and anonymous/authenticated direct access is revoked. Only the server secret can use the hub store; every API request first derives the parent household from the verified Supabase identity or validates the child's hashed, revocable session. Children receive no Supabase parent JWT. Existing school-paper Storage policies stay private; gallery originals use the same validated staging uploads and are streamed only after the hub's household/child-visibility checks.

Chore-star triggers update the ledger in the same transaction as routine checkoffs. Existing recorded chore checkoffs are imported once per task/day. Reward saves compare both the hub version and earned-star count while holding the household lock, so concurrent approvals or checkoff reversals cannot overspend a stale balance. Local SQLite receives equivalent tables/triggers automatically on restart.

No additional Vercel environment variables or DNS changes are required. Keep the five application variables from the original setup. Use **More → Stars & rewards → Set up child login** to create the separate child account; no child email or additional Supabase Auth user is created. Parents can reset/disable it from the same screen. Custom SMTP is still required for reliable parent confirmation emails if confirmation is enabled.

Before sharing the upgrade, run the parent/child tour in README, including an approved reward, a reset child password, and known private photo/API URLs from the child and third household. Automated fixtures do not verify a live Supabase migration, Vercel's streaming limits, real-device camera behavior, or provider email delivery.

## Optional development-only cloud seed

For a dedicated test project, fill `.env.local` with its Supabase values and add `ALLOW_CLOUD_DEMO_SEED=yes`, then run:

```sh
npm run seed:cloud
```

This creates confirmed fictional accounts `alex@example.test` and `sam@example.test` in one Team Bill household and `jordan@example.test` in a separate Team Robin household. All use `Backpack-demo-26!`. It does not send email. Repeating the command preserves existing passwords, records, and team names. The command refuses production/Vercel execution and requires explicit opt-in; regular parent accounts should use signup. Never use the demo accounts for personal family data. Remove the opt-in variable after seeding.

## Commands and what they verify

```sh
npm ci
npm run build
npm run typecheck
npm test
npm run test:cloud
```

`npm test` verifies the preserved local SQLite backend. `test:cloud` executes the actual Postgres migration and RLS policies in PGlite, then drives the actual Supabase SDK and Next.js app against local Auth/Storage HTTP test doubles. It includes independent parent sessions, a 6 MB direct upload and streamed original, rejected-upload drafts, household/anonymous denial, status idempotency/finality, invitations, email confirmation/PKCE cookies, and onboarding. These tests need the production build and a free port 3334. They use isolated fictional data and do not contact a real Supabase project.

These local checks do **not** establish that your Supabase project has the migration, your Vercel deployment has the right environment variables, SMTP can send email, or Cloudflare DNS/certificates are correct. Verify those against the actual projects before sharing the URL. Phone camera/file-picker behavior, mobile PDF viewing, and device networking also need hands-on checks.

To use Supabase locally, copy `.env.example` to `.env.local`, fill in project values, change `APP_BACKEND` to `supabase`, and set `APP_ORIGIN` to the exact local origin printed by Next.js. Add that local `/auth/callback` URL to Supabase's allowed redirects if testing email confirmation. Production must use the HTTPS origin. Leave `APP_BACKEND=sqlite` for the original self-contained local setup.
