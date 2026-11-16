# LeaveDesk — Staff Leave Request & Approval Portal

A responsive web app replacing spreadsheet/WhatsApp leave tracking for a company of approximately 30 employees. Staff request leave and view balances; Department Heads review requests in their departments; HR oversees company-wide requests, employees, entitlements, and Excel reporting.

## 1. What it does

- **Staff:** Log in, request Annual/Sick/Unpaid leave, see working-day totals and annual balances, edit/withdraw pending applications, view history and a personal calendar.
- **Department Head (Manager):** All staff leave features for their own account, plus review staff requests from their own department, see overlapping approved leave, and use a team calendar. Manager leave requests are reviewed by HR, not by the applicant.
- **HR Head:** View company-wide statistics and requests, approve/reject Manager requests, search employees, adjust per-person entitlements, create employee accounts, and download filtered Excel leave reports.
- **Data integrity:** PostgreSQL constraints and server-side functions protect leave rules and status transitions. A leave audit table retains status changes.

**Leave status labels:** Pending, Approved, Rejected, Cancelled and Withdrawn. The original brief used four statuses; Withdrawn was added to distinguish an employee's withdrawal of a pending request from other cancellations.

### Technology

| Layer | Technology |
| --- | --- |
| Frontend | React, TypeScript, Vite |
| Database and authentication | Supabase (PostgreSQL, Auth, RLS) |
| Business rules | PostgreSQL migrations, constraints and RPC functions |
| Excel export | ExcelJS |
| Hosting | Vercel (frontend), hosted Supabase (backend) |
| Tests and CI | Vitest / database tests; GitHub Actions |

## 2. Live URL and demo accounts

**Live site:** https://staffleaveportal.vercel.app

**Repository:** https://github.com/khushi0052/staff-leave-portal

The following accounts are intended for assessment use with disposable demo data.

| Role | Email | Password |
| --- | --- | --- |
| Staff | `pooja@example.com` | `admin@123` |
| Department Head / Manager | `anjali@example.com` | `admin@123` |
| HR Head (optional) | `sonia.hr@example.com` | `admin@123` |

The demo dataset is designed for **four departments, 26 Staff accounts, four Manager accounts and one additional HR account**. The 30 employees are Staff and Managers; HR is an additional role.

## 3. Local setup from a clean clone

### Prerequisites

- Node.js (current LTS recommended) and npm
- Git
- Docker Desktop, running, with WSL2 integration on Windows
- Supabase CLI (the commands below use `npx supabase`)

### A. Clone and install

Run in **PowerShell**:

```powershell
git clone https://github.com/khushi0052/staff-leave-portal.git
cd staff-leave-portal
npm install
cd web
npm install
cd ..
```

The repository contains a Vite app under `web/`, Supabase migrations under `supabase/migrations/`, and local utility/seed scripts under `scripts/`.

### B. Start the local database and apply migrations

```powershell
npx supabase start
npx supabase db reset
npx supabase status
```

**Warning:** `supabase db reset` resets the **local** Supabase database and reapplies local migrations. Do not run a reset against the hosted project.

The usual local values are:

- API URL: `http://127.0.0.1:54321`
- Studio: `http://127.0.0.1:54323`
- Database: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`


### C. Configure environment variables

Create `web/.env.local` using local values from `npx supabase status`:

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH
```

For **server-side seed scripts only**, create a root `.env` (ignored by Git) with:

```dotenv
SUPABASE_URL=http://127.0.0.1:54321
SERVICE_ROLE_KEY=sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz  
```

The root service-role key must **never** be added to `web/.env.local` or to any `VITE_` variable. Check that `.env`, `.env.local`, and other secrets are ignored by Git.

### D. Seed demo accounts and historical requests

```powershell
npx tsx scripts/seed.ts
```

The project also contains `scripts/seed-history-db.ts` for the deterministic 5,000-request dataset. **It defaults to dry-run mode**:

```powershell
npx tsx scripts/seed-history-db.ts
```

Its write mode is gated by `SEED_HISTORY_WRITE=I_UNDERSTAND`; hosted writes require additional confirmation. The dry-run command does **not** insert the 5,000 historical requests. Re-running the writer after manually updating seeded statuses can produce deterministic record mismatches.

**Local seeding limitation:** A complete fresh-clone run of the demo-user and historical-request seed workflow has not been verified. The `seed.ts` command alone is not confirmed to reproduce the full hosted dataset.

### E. Run the frontend

```powershell
cd web
npm run dev
```

Open the URL printed by Vite (typically http://localhost:5173). Log in with a locally seeded account, **not** with an account that exists only in hosted Supabase.

### F. Build and run tests

```powershell
npm run build
```

The exact local automated-test command and successful GitHub Actions execution have not been independently verified. Database integration tests, where configured, require a `DB_URL` pointing to a local test database.

## 4. Decisions and trade-offs

The six product questions in Section 6 are answered below, including the chosen rule and its rationale.

| Open question | Decision | Reasoning |
| --- | --- | --- |
| 1. Is 10–12 November two or three days? | **Dates are inclusive**: three calendar days if all three qualify as working days. | Matches how employees ordinarily request a start and an end day. |
| 2. Do weekends and public holidays count? | **No**. Count Monday–Friday, excluding dates in `public_holidays`. | A day off should consume entitlement only if it would otherwise be worked. |
| 3. Can requests overlap? | **No overlapping Pending/Approved requests for the same employee**; enforced in PostgreSQL with a date-range exclusion constraint. | Prevents double booking even if two submissions happen concurrently. Different employees can overlap. |
| 4. Can leave be backdated? | **Annual/Unpaid:** no past start date. **Sick:** up to 14 days back. | Sick leave can genuinely be reported after an absence; planned leave should be requested in advance. |
| 5. What if approval makes balance negative? | **Reject the approval**; recheck annual entitlement in the locked database transaction. | Avoids race conditions and accidental negative balances. Sick/Unpaid do not deduct annual entitlement. |
| 6. How far ahead can leave be requested? | **At most 12 months** in advance. Requests crossing calendar years are rejected with a clear message. | Keeps forecasting and annual entitlement calculations simple and predictable. |

### Additional choices beyond the minimum brief

- **HR Head role:** Added company-wide oversight, entitlement editing, employee account creation and Excel exports. This extends the optional HR feature while keeping approval authority separate from department heads.
- **Manager requests go to HR:** Department Heads cannot approve their own leave. A Manager reviews Staff requests from their own department; HR reviews Manager requests.
- **Withdrawn status:** An employee can withdraw a Pending request while keeping it in history; reserved days are released through derived balance calculation. This status goes beyond the original four-status list.
- **Derived leave balance:** Per-person entitlement lives on the profile. Approved annual working days reduce the balance; Pending annual days are reserved for availability. Sick/Unpaid leave does not reduce annual balance.
- **Pro-rated joining-year entitlement:** The employee creation flow estimates part-year entitlement from the joining month (e.g., June joiner → 10 days in a 20-day year). The joining month is excluded except January, which receives the full year under the current rule. HR can adjust the individual entitlement.
- **5,000 historical requests:** Deterministic seed data was used to exercise dashboards and report performance. Historical demo Pending statuses were later administratively cancelled when expired, so the hosted dataset may differ from a freshly seeded dataset.
- **Report filtering:** HR can filter by department, employee, role, status and leave date range, then export matching records to an A4-landscape Excel report.
- **UI trade-off:** Compact dashboard layouts prioritize first-screen visibility, with separate views for detailed calendars and request records. Very narrow mobile displays still require careful accessibility and layout testing.

## 5. Data, security and performance

- Tables include `departments`, `profiles`, `public_holidays`, `leave_requests` and `leave_audit`.
- Supabase Auth handles sign-in; PostgreSQL Row Level Security (RLS) determines which records users can read.
- Managers are scoped to their department. Staff are scoped to their own requests. HR has company-wide visibility.
- Sensitive actions should be executed through database RPC functions (such as `submit_leave`, `review_leave`, `cancel_leave`, `leave_balance` and entitlement adjustment), not direct client-side privileged writes.
- An audit record is intended for each status transition. Audit records should not be editable or deletable through the UI.
- HR dashboards currently fetch historical requests in paged batches and use a short-lived in-memory cache. This helps with approximately 5,000 records but is not a substitute for server-side reporting/pagination at larger scales.

**Dataset note:** During development, hosted Supabase contained roughly 5,000 historical plus pre-existing requests. Exact totals change with additions, cancellations and withdrawals; the displayed totals are calculated from current records.

## 6. Known limitations / work before real use

1. **Automated testing and CI are not fully verified.** A production build does not establish that database integration tests pass or that GitHub Actions is green.
2. **Fresh-clone setup has not been end-to-end verified.** Local demo-user creation, seed order, the `hr-create-employee` Edge Function and automated test execution may require additional configuration.
3. **Historical records are synthetic.** Seeded names, reasons and decisions are for demonstration, not evidence of real absences or actual HR decisions. Administrative cleanup changed some old Pending records to Cancelled.
4. **Seed re-runs after manual changes are restricted.** The historical seeder compares deterministic records with what exists and may refuse to proceed after manual status cleanup. A clean database reset is preferable to forcing writes into a modified dataset.
5. **HR data loading can be heavy.** Several thousand requests are downloaded to the browser for company-wide calculations; production use should move summary aggregation, filtering and pagination to server-side queries/RPCs.
6. **Joining-year entitlement is a simplified policy.** The 20-day baseline and monthly proration should be configurable, reviewed against company policy, and handled consistently in later years.
7. **Notifications and audit review need productization.** The interface may not provide email notifications, a complete audit viewer, or operational monitoring for administrators.
8. **Production security and responsive coverage are limited.** Cross-department access, permission boundaries, mobile layouts and sign-out need broader testing before real-world deployment.
9. **Reporting prints one page wide, not necessarily one page total.** A report with many rows uses multiple pages vertically to remain readable.

## 7. How I used AI

I used ChatGPT as a **coding assistant and tutor** while building LeaveDesk. AI helped draft TypeScript/React components, Supabase SQL/RPC ideas, historical seeding scripts, CSS layouts, and Excel export logic. I reviewed outputs, ran commands and builds locally, inspected database results, tested the live screens, and requested corrections when generated changes broke the UI.

**My work and substantive corrections:** I chose the project requirements and leave policies, set up the local Windows/WSL/Docker/Supabase development environment and GitHub/Vercel workflow, ran seeding and SQL-verification commands, and iteratively corrected the HR, Manager and Staff dashboards to meet the functional and visual requirements. 

**Specific AI error I caught:** AI-generated code for the Add Employee `Manager / Staff` dropdown left an extra `</label>` in `AddEmployeeForm.tsx`. `npm run build` failed with JSX parsing errors. I identified the failing file from the TypeScript compiler output, provided the code for review, and corrected the JSX without changing the employee-creation backend. Another example was a donut chart that became distorted after a style change and required a targeted CSS correction.

**My approach to AI-generated code:** Treat suggestions as drafts; inspect the diff, run the build and tests, and verify permissions and data in Supabase before committing.
