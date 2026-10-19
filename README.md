# PawHaven

PawHaven is a reusable animal shelter and adoption system for organizations that care for cats and dogs. One installation can host many independent client organizations. Each organization operates one, two, or three shelters. The product name, colors, contact details, shelters, and operational labels are organization settings, not hardcoded shelter data.

Staff use PawHaven to register animals, record health information supplied by caregivers and veterinary professionals, move animals between shelters, review adoption applications, and report on the animals actually in the database.

## Architecture

PawHaven is a Next.js 15 application with React 19, TypeScript, Tailwind CSS, Zod, and Prisma 6. The supported database is SQLite with foreign keys, WAL mode, and a busy timeout. That keeps a single-server deployment simple. It is not a multi-writer hosted database.

The browser talks to one API route, `src/app/api/[...path]/route.ts`, which dispatches to server modules under `src/server`. Domain rules that must stay consistent (status transitions, shelter capacity, adoption workflow, file checks, CSV safety) live in `src/domain` and are covered by unit tests. Pages under `src/app` and `src/features` are the operational interface.

Tenant isolation is enforced on the server. Every organization-owned record stores `organizationId`. Shelter-owned records also store a shelter that belongs to that organization, backed by composite foreign keys. A request may name an organization or shelter only after the session membership and shelter assignments allow it. A miss is returned as not found so callers cannot probe other tenants. Platform administrators manage organizations and the platform shelter cap. They do not receive tenant medical records or applicant details.

The shelter cap is `min(organization override, platform maximum)`, defaulting to 3. Creating a shelter increments `organizations.shelterCount` with a conditional update inside a transaction (`shelterCount < max`). A fourth shelter is rejected even if several requests arrive together. Deactivating a shelter does not free a slot, and shelters are not deleted, so the cap cannot be bypassed by removing a row.

Adoption finalization runs in one database transaction. It writes the adoption, updates the animal to adopted, and records history together. A partial unique index allows only one active adoption per animal. If finalization fails, neither the adoption nor the status change is kept.

## Local setup

Requirements: Node.js 20 or newer and npm.

```bash
npm ci
cp .env.example .env
# Set SESSION_SECRET to a long random value before sharing the instance.
npm run db:migrate
npm run dev
```

The app listens on [http://localhost:3000](http://localhost:3000). `DATABASE_URL` in `.env.example` points at `prisma/dev.db`. Uploaded photos and documents go to `STORAGE_PATH` (default `./storage`), which is outside the web root and ignored by git.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQLite file URL, for example `file:./dev.db` |
| `SESSION_SECRET` | Pepper for session token hashes. Required, and rotating it signs everyone out |
| `STORAGE_PATH` | Private directory for photos and documents |
| `BCRYPT_ROUNDS` | Password hashing cost. Use `12` outside tests |
| `TRUST_PROXY` | Set `true` only behind a trusted reverse proxy so rate limits see the client address |
| `ALLOW_DEMO_SEED` | Must be `true` before `npm run db:seed-demo` will insert sample records |

## Create the first administrator

Do this from a shell on the server. The password is not printed.

```bash
ADMIN_EMAIL="admin@example.com" \
ADMIN_NAME="Platform Admin" \
ADMIN_PASSWORD="choose-a-unique-password" \
npm run admin:create
```

The password must be at least 10 characters and must not match the email. Sign in with that account. To replace the password later, run the same command with `ADMIN_RESET=true`.

## Configure a client organization

1. Sign in as the platform administrator and open **Platform**.
2. Create an organization and its first administrator. The temporary password is shown once on that screen. Copy it into a password manager and share it through a channel you control. PawHaven does not email it.
3. Sign out, sign in as the organization administrator, and replace the temporary password. The rest of the application stays locked until that change is saved.
4. The setup screen asks for the first shelter. One shelter is enough. Capacity is optional and is used only for occupancy reporting.
5. To add a second or third shelter, open **Settings** and use **Add shelter**. The server rejects another shelter once the organization reaches its limit.
6. Add staff from **Settings**, choose a role, and assign the shelters that person may use. Organization administrators can reach every shelter in that organization. Other roles only see their assigned shelters.
7. Adjust branding, time zone, currency, intake sources, adoption agreement text, fee recording, and reminder lead time in **Settings**. Organization administrators keep full permissions. Other roles start from a template and can be narrowed.

The platform setting **Maximum shelters per organization** applies to every organization and cannot be exceeded by an organization override. The default is 3. The accepted range is 1 through 50.

`npm run db:seed-demo` inserts a clearly named sample organization only when `ALLOW_DEMO_SEED=true`. It is not part of normal startup.

## Roles

| Role | Scope |
| --- | --- |
| Platform administrator | Organizations, platform name, and the shelter cap. No tenant clinical or applicant records |
| Organization administrator | One organization's settings, shelters, users, animals, care, adoptions, and reports |
| Shelter manager | Assigned shelters, including users and transfers for those shelters |
| Animal care | Animal profiles and non-clinical care notes on assigned shelters |
| Veterinary | Medical records and care tasks. Not applicant contact details |
| Adoption staff | Applicants and adoptions. Not medical records |
| Read-only | Explicitly authorized operational records, without applicant or medical detail |

Permissions are checked on every protected API operation. Hiding a navigation link is not the access control.

## Operational workflow

- Register a cat or dog with the details staff actually know. Unknown breed, age, microchip, and previous owner can be left blank.
- Search by name, public ID (`A-000001` style), or microchip. Filter by species, status, and shelter.
- A possible duplicate (same normalized name, species, and color, or the same microchip) must be acknowledged before it is saved. Microchip numbers are unique inside an organization.
- Animal edits carry a version. If someone else saved first, the update is rejected instead of overwritten.
- Record veterinary visits, vaccinations, medications, treatments, allergies, and follow-ups on the animal. A diagnosis can be stored only when a named veterinary professional is recorded as the source. Staff are recording information, not generating a diagnosis.
- Corrections supersede a medical record and keep the original. Medication administration is a separate explicit action. An overdue follow-up is a reminder, not a clinical emergency. Missing medical records do not mark an animal healthy.
- Adoption applications move Draft → Submitted → Under review → Screening → Approved or Rejected, and can be withdrawn or placed on hold. Approval requires a written reason and reserves the animal. Finalizing records the adopter, date, agreement text, optional fee, and staff member, and sets the animal to adopted.
- An animal can be returned to care later. The original adoption stays in history.
- Transfer an animal to another shelter in the same organization from the animal profile. The public ID and history stay with the animal. The status does not become "Transferred" for an internal move. "Transferred" is for an outcome outside the organization.
- The dashboard counts animals, applications, occupancy, and follow-ups from the database. Reports can be exported to CSV. Cells that could be interpreted as spreadsheet formulas are prefixed. Applicant contact details are omitted unless the role may view them.

## Tests

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

`npm test` runs Vitest unit and integration tests against `file:/tmp/pawhaven-test.db`. Integration coverage includes tenant isolation, the shelter cap under concurrent creates, duplicate detection, medical diagnosis rules, atomic adoption finalization under a race, transfers, dashboard figures, CSV export permission, and CSRF.

`npm run test:e2e` runs Playwright against Chrome. It creates an organization, changes the temporary password, configures three shelters, rejects a fourth, registers a cat and a dog, records a visit and a vaccination, finalizes an adoption, transfers the other animal, checks the dashboard and population report, and opens the navigation at a phone width. Playwright uses `file:/tmp/pawhaven-e2e.db` and does not touch the development database.

## Deployment

Run one Node process per SQLite database. Do not point several app servers at the same database file.

```bash
npm ci
npm run db:migrate
npm run build
npm run start
```

Put the process behind HTTPS. Set `SESSION_SECRET`, `DATABASE_URL`, and `STORAGE_PATH` in the environment, not in source control. Keep `STORAGE_PATH` on a persistent disk. Set `TRUST_PROXY=true` only when a trusted proxy overwrites the client address. Session cookies are HTTP-only. Mutating requests also require the matching CSRF cookie and `x-pawhaven-csrf` header. Login is rate limited.

Apply migrations with `npm run db:migrate` (`prisma migrate deploy`) before starting a new release. The initial migration is `prisma/migrations/20261019120000_init`.

### Backup and restore

Stop the app, or use SQLite's backup command so the WAL is consistent. Copy both:

- the database file named by `DATABASE_URL`, including any `-wal` and `-shm` files if the app was not cleanly stopped
- the entire `STORAGE_PATH` directory

Restore by stopping the app, replacing those two locations with the copies, and starting the app again. Do not restore a database without the matching storage directory, or photo and document links will point at missing files. Test a restore on a copy before relying on it.

There is no built-in offsite backup job. Schedule the copy with the tools you already use for the host.

## Security notes

- Passwords are hashed with bcrypt. Session tokens are random and only their SHA-256 hash, peppered with `SESSION_SECRET`, is stored.
- Authorization, tenant checks, and shelter checks run in the API. Platform, organization, and shelter scopes are separate.
- Uploads are limited in size and accepted only when the file signature is JPEG, PNG, WebP, or PDF. Stored paths cannot escape `STORAGE_PATH`.
- Audit events record sensitive changes with the acting user. Medical corrections and adoption returns keep history.
- PawHaven does not claim compliance with any jurisdiction's animal-welfare, veterinary, or privacy statute. Confirm retention and consent rules before production use.
- Collect only the applicant details needed for screening. Public animal listings are not part of this application, so applicant data is not published there.

## Known limitations

- SQLite is the database. A PostgreSQL migration is not included. One app process should own the database file.
- There is no email delivery, public adoption site, payment processor, or PDF report. Adoption fees are optional recorded amounts, not charges.
- Uploaded files are checked by signature and size. They are not scanned for malware.
- Internal transfers keep the animal in its current care status. An external transfer, reunion, or death is a separate outcome.
- An adopted animal is not marked deceased from the outcome form. Record a return or a follow-up note instead.
- Custom status labels cannot replace the built-in status rules.
- The interface requires a network connection to the server. It does not queue offline edits.
- Dependency audit warnings in transitive packages were not force-upgraded when the upgrade would leave the tested stack.
