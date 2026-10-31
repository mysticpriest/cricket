# Cricket | Demo-ready employee workspace

Cricket is a local-development workflow application with an employee sign-in, role-aware operations dashboard, guided Inbound workflow, automatic case capture, and QC review tools. Use **fictional test data only**. This is not a production patient data platform.

## Run the presentation demo (Windows)

1. Download or pull the latest `main` branch from GitHub.
2. Install Node.js 22.13 or newer (Node 24 LTS or Node 26 works for local testing).
3. In PowerShell, open the Cricket folder. On the first run, set the administrator credentials:
   ```powershell
   $env:CRICKET_ADMIN_EMAIL="your-work-email@example.test"
   $env:CRICKET_ADMIN_PASSWORD="REPLACE-WITH-A-UNIQUE-LONG-PASSWORD"
   npm.cmd start
   ```
4. Subsequent restarts generally only need `npm.cmd start`, because the administrator is already stored in your local SQLite database.
5. Open `http://127.0.0.1:3000`. Sign in; there is no anonymous dashboard.
6. As administrator, use **Staff accounts** to create fictional Agent and QC Reviewer accounts, with each employee's **name**, email, role, and password. Existing accounts have an **Edit name** action; update older accounts instead of recreating them.
7. Sign in as Agent → open Inbound → enter a **fictional phone number** such as `(404) 555-0148` before choosing any route → choose Clinic Information → provide the main phone number → complete documentation → copy the generated **Case ID**. The case stores the caller phone and call-start timestamp separately from its opaque Case ID.
8. Sign out, sign in as QC Reviewer → open **Quality Control** → search by Case ID or call number → inspect the number and start time to locate the recording in your **separate, approved** call recording system → score and submit the review. Cricket itself does not contain any audio or a call-recording integration.
9. Sign in as Administrator to show both divisions and employee management.

### Employee access matrix

| Role | Inbound | Outbound (planned) | My cases | Quality Control | Staff accounts |
|---|---|---|---|---|---|
| Agent | Yes | Preview | Own cases | No | No |
| QC Reviewer | No | No | No | Yes | No |
| Administrator | Yes | Preview | All cases | Yes | Yes |

The backend **enforces** these permissions for page resources and APIs. An Inbound call now starts with a required caller number (7–15 digits with optional formatting) before the route grid is displayed. On **Start New Call** the form is reset; on **Another Inquiry — Same Call** the number stays attached.

### Existing local databases

The server runs additive SQLite migrations on startup, preserving existing users, sessions, and documented cases. Legacy accounts do not automatically receive a guessed name from their email address; an administrator can use **Staff accounts → Edit name** to set their real display name. Previously documented cases correctly display “Not captured (older case)” because they did not have caller numbers.

### Recording matching and privacy

A Case ID remains a unique non-identifying reference; the caller number is stored as **separate case metadata** (with a recorded call start time) and can be searched by QC. A phone number is **not a unique recording identifier** and cannot by itself open or retrieve a recording. If integrated with a recording vendor in the future, use the vendor's immutable recording ID and access-controlled link. Until then, match a fictional number + timestamp manually inside an approved system. Do not put real caller numbers, PHI, or recordings into this demo.

The backend **enforces** these permissions for page resources and APIs. The dashboard's locked cards are informational; removing a link is not an authorization mechanism. Do not use GitHub Pages to host a sensitive app: GitHub Pages cannot enforce these server-side roles.

# Cricket – Quality Control development build

This repository contains Cricket's existing Inbound guided workflows plus a **case-based Quality Control (QC) backend** and reviewer dashboard. It is a development prototype, **not approved for storing patient-identifying information or production clinical use**.

## Start locally

Install Node.js **22.13 or later**. There are no npm dependencies: the prototype uses Node's built-in SQLite module. The first launch requires an administrator email and a strong password supplied in environment variables (do **not** put them into the repository or frontend):

**macOS/Linux**

```bash
export CRICKET_ADMIN_EMAIL='admin@example.test'
export CRICKET_ADMIN_PASSWORD='Choose-a-long-unique-password-here'
npm start
```

**Windows PowerShell**

```powershell
$env:CRICKET_ADMIN_EMAIL='admin@example.test'
$env:CRICKET_ADMIN_PASSWORD='Choose-a-long-unique-password-here'
npm start
```

Open **http://127.0.0.1:3000** (do not open the `.html` files via `file://`). Use **Sign in** on the dashboard. The first administrator is created once, on an empty database; later restarts do not require the bootstrap variables.

The SQLite DB is in `data/cricket.db` and is excluded from Git. Back up this directory if you need to retain local test cases. Do not commit the DB, credentials, or patient data. Passwords use salted scrypt hashes and sessions are held in HttpOnly cookies.

## Test the system

```bash
npm test
```

The test suite spins up a separate temporary database and checks login, access controls, case creation, Case ID uniqueness, case search and QC scoring. No real patient data is needed.

## Create staff accounts

Log in as an administrator. With developer tools or an HTTP client on the same authenticated origin, `POST /api/users` accepts `{ "email": "...", "password": "...", "role": "agent" | "qc" | "admin" }`. The administrator-only API requires the active login session. A user-management page can be added after the core QC workflow is approved.

The roles work as follows:

- **agent:** can submit case records and read their own cases, but cannot QC-review them.
- **qc:** can search/read all cases and submit evaluations, but cannot submit agent cases.
- **admin:** can manage staff accounts, submit cases, and perform reviews.

## QC workflow

1. An agent signs in, starts an Inbound call, follows a route, and reviews the automatically generated note.
2. On **Complete Route & Copy Note**, Cricket keeps the existing shift log and separately sends the confirmed note + route actions to `POST /api/cases`. A server-generated `CR-YYYYMMDD-NNNNNN` Case ID is displayed only after a successful server response.
3. A QC reviewer signs in and opens `qc.html` from the dashboard. They search the case, inspect the original documentation and confirmed workflow events, mark criteria Pass/Fail/N/A, and submit a decision.
4. Reviews are appended (original notes remain unchanged). The case displays the latest review status, score, feedback, reviewer identity, and audit history.

**GitHub Pages only hosts static frontend files.** It cannot execute this backend or synchronize cases between employees. To run the case system, you must start the Node server locally or deploy the server and database to a secure host. GitHub is the source-control platform, not the case database.

## Security and Azure migration

This is a **non-PHI proof of concept**. Before any healthcare deployment, coordinate the clinic's applicable privacy, security, and compliance requirements, contracts, approved data-processing locations, logging policies, encryption, retention, backups, identity management, and role-based access with its authorized staff.

The development server deliberately binds to **127.0.0.1** by default. It is not production hardened. Do not publicly expose it without further controls, an HTTPS reverse proxy, central identity management, secure secrets, managed persistence, request monitoring, retention policies, and a professional security review.

Planned migration path:

- Azure Static Web Apps for the frontend.
- Microsoft Entra ID for workforce login and role mapping.
- Azure Functions or App Service for the backend (same `/api/...` API contract).
- Azure SQL Database for shared, durable cases, audit events and QC evaluations.
- Application Insights and managed backup/retention policies.

Do not use this local SQLite file on ephemeral Azure Functions storage; replace the storage layer with Azure SQL or another approved durable database before going live.
