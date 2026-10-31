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
