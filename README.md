# Cricket | Demo-ready employee workspace

Cricket is a local-development workflow application with an employee sign-in, role-aware operations dashboard, guided Inbound workflow, automatic case capture, and QC review tools. Use **fictional test data only**. This is not a production patient data platform.

## Reliable dashboard loading and portrait display support

**Personalized workspace initialization** is explicitly awaited before Cricket
finishes loading the dashboard. The previous one-time authentication event could
fire before the deferred customization script loaded, causing a blank/default
layout until the next refresh. The main dashboard and customizer now perform a
deterministic, single initialization step:

- Employee authentication and office permissions are checked first.
- The saved employee layout, notes, reminders and shift status are retrieved.
  Temporary network/server failures are retried automatically up to three times.
- Raw dashboard template sections stay hidden until the personalized blocks
  are mounted, preventing an incorrect temporary/default dashboard from flashing.
- If loading truly fails, Cricket shows a visible error and a **Retry loading
  workspace** button rather than silently losing its widgets.

On separate sections like Analytics, QC and Inbound, the specialized page
remains the active view. **Overview** is still the place to edit your Custom
Layout; returning to it reloads the same server-saved personal layout. Changing
sections does not clear or reset any saved customization.

**Vertical/portrait monitors** are supported, including common 1080×1920 and
1440×2560 configurations. Portrait CSS rearranges charts, QC panels, route
cards, presence/shift panels and dashboard widgets without forcing narrow
side-by-side layouts. Windows narrower than 851 CSS pixels now provide an
accessible **Menu** button and slide-out navigation instead of simply hiding
the sidebar. The menu supports keyboard Escape and outside-click dismissal.

This release is a UI/data-loading reliability improvement, not a change to
the office permissions, private case records, sticky notes or shift history.

## Employee sound effects (quiet and optional)

Cricket now has small, original **Web Audio** interface cues for button clicks,
page navigation, saved workflows, successful actions, invalid actions, shift
changes, and newly arriving office notifications. No external audio files,
copyrighted soundtracks, or third-party audio services are needed.

**Sound controls:** On any signed-in page, open the floating **Workspace**
panel and find **Sound effects** under its navigation links. Use **Sound on /
Muted** and the 0–100% volume slider. A preview plays when enabling sounds
or changing volume. Settings are saved in additive `users.sound_enabled` and
`users.sound_volume` columns **per employee account**, not per browser:
they persist through sign-out, refresh and the next shift. New employees
default to sound on at a restrained **25% volume**. Mute is always available.

Modern browsers require a **user click or keyboard interaction** before
allowing sound. Cricket never plays automatically when a page loads; the
first interaction unlocks its audio engine. The browser or operating-system
volume controls still apply. Unsupported browsers safely remain silent.

The Notification Center plays a short alert only when it detects a **new
unread notification after the first inbox load**, not whenever Cricket
refreshes or replays an old message. Alerts are suppressed while the
document is hidden and have a brief cooldown to avoid repeated sounds.

Sound does **not** transmit personal data, alter case documentation or
change the existing five shift statuses. The old `/api/preferences`
display-settings contract is unchanged; sound settings use a separate
authenticated `GET/PATCH /api/sound/preferences` API.

## Cricket Operations Suite — six integrated features

The latest development upgrade introduces office-isolated productivity and
workflow features. These are **local demonstration features only**: do not enter
real patient information, personal customer details, or real payroll records.

### 1. Workflow Builder and guided runner

- An **office administrator** opens `workflow-builder.html` from the
  Overview navigation or the universal Workspace panel.
- Create a draft/published route using up to 12 editable steps. Steps support
  free-text answers, Yes/No, and multiple-choice questions; reorder or remove
  them and select which are required. Publishing makes a route immediately
  available to agents **in that same office**.
- Agents open `workflow-runner.html`, select a published route, answer the
  questions, choose Resolved/Pending, and complete the route. The server
  validates each required response and creates a real office-scoped case in
  the **existing QC review queue**, with structured documentation. As in the
  original NeuTrauma workflow, agents receive a save confirmation without an
  exposed Case ID.
- Previously completed cases remain available to QC even if an administrator
  later unpublishes a route. This new workflow builder is separate from the
  original NeuTrauma-specific Inbound scripts and the previous starter-route
  instruction templates; neither legacy flow is deleted.

### 2. Universal Workspace panel

On **Overview, Analytics, QC, Inbound, Outbound, staff pages and other
authorized sections**, use the floating **Workspace** button to open an
office-aware panel with navigation, your personal sticky notes, reminders,
five-status shift clock, and notifications. It reads and saves through the
existing office-scoped server endpoints, not browser local storage.

### 3. Notification Center

The workspace panel has a Notifications tab. Office announcements, direct
colleague messages, QC feedback, upcoming scheduled shifts, and due reminders
generate private notifications. Mark entries as read or open their destination.
The panel refreshes approximately every 18 seconds while visible.

Notifications are **in-app only** (no browser push, SMS, or email). Reminder
alerts are created when a user next loads/polls notifications and a reminder
falls within the upcoming 24-hour window. QC results go only to the case
owner; cross-office notification access is blocked.

### 4. Workforce calendar and correction requests

`workforce.html` displays upcoming scheduled shifts and actual clock events.
An office administrator can schedule staff, remove planned shifts, review
employee correction requests and export a CSV of office timesheets.
Employees can request a correction for one of **their own completed shifts**.
Approvals record a separate audited decision and **do not rewrite original
clock-in/out timestamps**. Managers should verify corrections manually.

This is an internal shift-planning preview, **not payroll, legal attendance
or compliant timekeeping software**. The existing Start Shift, Break,
Meeting, System Issues and End Shift controls remain operational.

### 5. Team Hub

`team-hub.html` contains administrator-published office announcements and
direct messages to a colleague from the **same office**. Announcement
notifications reach that office's employees, and direct-message
notifications reach the recipient. Agents cannot publish announcements.

### 6. Global command palette

Press **Ctrl + K** (or **Cmd + K** on Mac) from any page that includes
the universal Workspace panel. Search navigation, published workflows, and
for QC/admin staff, permitted case references. Results are restricted by
employee role and office. An accessible Search control is also present in
the panel for those who prefer not to use keyboard shortcuts.

All new feature data is stored in additive SQLite tables. On upgrade,
**back up the entire `data` folder**. No existing office credentials,
employees, saved layouts, notes, reminders or case history are reset.

## Custom Layout — personal dashboard widget library

The Cricket **Overview** dashboard now starts with one required block:
**Workspace Tabs**. Every other dashboard block is optional.

Click **Custom Layout** to open a smooth slide-in widget library. The library
shows available widgets with descriptions and **+ Add** actions:

- **Case Snapshot** — documented cases and outcome counts
- **Active Agents** — presence and live workflow activity
- **Quick Access** — links to common workflow actions
- **Reminders** — personal due dates and completed items
- **Sticky Notes** — personal color-coded notes
- **My Shift Clock** — Start Shift, Break, Meeting, System Issues, End Shift

The **Shift Walkthrough** block has been removed completely.

Every installed block can be resized (Small / Medium / Full width) or removed
from the dashboard in **Custom Layout**. Removing a block hides it; it **does
not delete** any saved notes, reminders, time-clock history or account data.
Use **Reset to Workspace Tabs only** to return to the default dashboard.

Blocks, sidebar tabs, workspace shortcut cards and individual sticky notes
retain their **nine-dot drag grip** (mouse/touch/pen and keyboard arrows) and
their **paintbrush palette**. Choosing a color applies a subtle **solid pastel
background** to the full card; there are no gradients and borders remain
neutral. The nine-dot grip and brush appear only when the cursor hovers over
the card or tab, or when it receives keyboard focus. On touchscreens, the
controls remain available without hover so touch dragging and recoloring work.

Existing personal layouts are migrated once to the new version: Workspace
Tabs stays visible, while other blocks start hidden in the widget library.
Their previous sizes, colors and order remain available when added back.
The upgrade removes only the obsolete Shift Walkthrough configuration.
Existing employee notes and reminders are preserved.

**Preferences persist on the Cricket server** in a per-user database row, so the
same employee can sign out, return for another shift, or sign in from a different
device to the same server and see their saved arrangement. Personal layouts
never override office or role permissions. These controls organize the Overview
dashboard and its tabs; they do not redesign individual workflow step screens.

**Sticky notes:** add, edit, pin, color or delete private notes. They are stored
only in your account and office. Max 60 notes, each with a 100-character title
and up to 4,000 characters of text.

**Reminders:** add a title, optional details and optional local due date/time;
mark completed, edit or delete. Past-due items are highlighted when you open
the dashboard. Max 120 reminders. Reminders appear **inside the workspace**;
there is no email, push notification or operating-system alarm integration yet.

### Five shift statuses

The **My shift clock** block provides these five actions:

| Action | Meaning |
| --- | --- |
| **Start Shift** | Clock in; when on Break/Meeting/System Issues, return to active work without creating a duplicate shift |
| **Break** | Mark your current shift as on break |
| **Meeting** | Mark your current shift as attending a meeting |
| **System Issues** | Record system problems during your active shift |
| **End Shift** | Clock out and close the current shift record |

Every shift transition is timestamped **on the server**, written to a separate
immutable event list and added to the role-protected activity audit. The **Live
Operations** dashboard includes an office-scoped **Staff time clock** panel
that refreshes approximately every **4 seconds**, showing each employee's
latest status, clock-in time, latest transition, elapsed duration and recent
shift events. Only an administrator of the same office can view these records.
A Cricket Platform Administrator cannot inspect client shifts.

**Important:** signing out or allowing the session to expire does **not**
automatically clock out the employee. Managers should treat an unclosed shift
as requiring review; this preview does not calculate payroll or certify
attendance. Time periods include breaks, meetings and system-issue time unless
the employer defines a separate policy. Backend authentication and office
isolation still apply to all endpoints.

API endpoints used by the new features:
`GET /api/workspace/me`, `PUT /api/workspace/layout`,
`POST/PATCH/DELETE /api/workspace/notes[/:id]`,
`POST/PATCH/DELETE /api/workspace/reminders[/:id]`,
`POST /api/workspace/shift`, and administrator-only
`GET /api/admin/shifts`.

**Safety:** These are development-only internal productivity features. Use
fictional information in notes and reminders. Do not store patient-identifying
information, other restricted data or real attendance/payroll records without
a separate security, privacy and employment-policy review.

## Branded office access and Northstar Support demonstration

The new `office.html` and `login.html` use a restrained, responsive two-step sign-in experience. After an Office Key is validated, Cricket shows a brief **client-specific welcome transition** before showing employee credentials. The transition respects `prefers-reduced-motion`.

**NeuTrauma** uses the actual supplied logo (optimized, stored at `assets/neutrauma-logo.webp`), its Concussion Care label, and a restrained blue accent on the welcome and login screens. The logo is only a public display asset. It is not an authentication credential.

**Other offices** display their own name, initials, tagline, welcome message and accent color. Office branding is stored in additive `offices` columns (`brand_tagline`, `brand_color`, `brand_welcome`, `brand_logo_url`). A Cricket Platform Administrator can edit tagline, color and welcome message under **Client offices → Client sign-in branding**. Logo URLs are strictly server-controlled; this version does not permit arbitrary uploads or external image URLs.

### Create a demonstration office

For a quick fictional **Northstar Support** demo, there are two options:

**Option A — Automatically initialize on the next local development start** (recommended when you have not configured a Cricket Platform Administrator):

```powershell
# From the Cricket project folder — back up data first.
$env:CRICKET_SEED_DEMO_OFFICE="1"
$env:HOST="127.0.0.1"
$env:PORT="3001"
npm.cmd start
```

On its **first creation only**, Cricket generates the Northstar Office Key and a random administrator password. It displays both once in the PowerShell terminal, alongside the email `northstar-demo@cricket.example.test`. **Save all three immediately**. The database retains the office and password hash; existing clients and cases stay unchanged. The seed is opt-in, idempotent, and explicitly **blocked in production**. Remove the environment variable after setup if desired.

Sign in at `http://127.0.0.1:3001/office.html` with the Northstar key and demo administrator credentials. You can create additional fictional Northstar staff via the existing Staff Accounts page.

**Option B — From the Platform Administration page:** Click **Use Northstar Support demo template**, fill in a new office administrator's name, email and secure password, and press **Create office + generate key**. A new unique Office Key is displayed once. Avoid creating the same `northstar-support` office twice: the system prevents duplicate office slugs.

The Northstar demo contains six *fictional customer-support routes*: Order Status Inquiry, Refund Request, Delivery Issue, Product Exchange, Billing Question, and Supervisor Escalation.

As before, **starter routes are for demonstration and local draft notes only**. They do not submit real cases, invoke QC, or integrate with an order management system. NeuTrauma retains all of its existing specialized routes and working case/QC features. This remains a **non-PHI development prototype**, not an approved healthcare deployment.

## Office Keys and multi-client workspaces (foundation)

Cricket now begins with **Choose Your Office** at `/office.html`. Enter the office-specific key, then use your employee's email and password. Office Keys identify the organization and **do not replace employee authentication**. The key is exchanged for a short-lived, HttpOnly selection cookie; the server binds login to the selected office. Every employee session carries its office identity.

**NeuTrauma is Office 1**, preserving all existing Inbound routes, QC reviews, documentation, employee accounts, analytics, and audit records. Existing local users/cases/reviews/audits/presence records receive the NeuTrauma office ID in an **additive SQLite migration**. Keep a complete backup of the `data` folder before updating.

### Starting the upgraded server

On the **first startup after migration**, supply a new strong NeuTrauma Office Key using `CRICKET_NEUTRAUMA_OFFICE_KEY` or allow Cricket to generate a secure random one and display it **once in the Node terminal**. Copy it before closing the terminal. Keys are stored as SHA-256 hashes, not plaintext.

```powershell
# On a NEW database also configure CRICKET_ADMIN_EMAIL and CRICKET_ADMIN_PASSWORD.
$env:CRICKET_NEUTRAUMA_OFFICE_KEY="REPLACE-WITH-YOUR-OWN-UNIQUE-32-CHARACTER-KEY"
$env:HOST="127.0.0.1"
$env:PORT="3001"
npm.cmd start
```

The `CRICKET_NEUTRAUMA_OFFICE_KEY` variable only sets the key when the NeuTrauma office is *first created* in the database. Changing it later does **not** silently rotate a stored key. Use the platform-admin rotation control to create a new key. Never put real keys into GitHub or client-side JavaScript. Do not share credentials or key values in screenshots.

### Optional Cricket Platform Administrator

To enable the platform console, set **all three** variables **before starting Cricket**:

```powershell
$env:CRICKET_PLATFORM_ADMIN_EMAIL="owner@example.test"
$env:CRICKET_PLATFORM_ADMIN_PASSWORD="REPLACE-WITH-A-SECURE-PASSWORD"
$env:CRICKET_PLATFORM_OFFICE_KEY="REPLACE-WITH-AN-INDEPENDENT-UNIQUE-PLATFORM-KEY"
npm.cmd start
```

The platform identity is **separate from NeuTrauma office administrators**. Sign in with the platform key through `office.html`, followed by those platform credentials. You'll land on `platform.html`, where you can:

- Create a client office and an initial office administrator.
- Generate an office key (displayed only once), rotate or deactivate that key.
- Activate/deactivate an office and configure starter route names and instructions.
- View office names and high-level employee/case counts, but **not client cases, caller numbers, documents or QC reviews**.

Each newly created office starts with a **generic starter workflow** at `office-workflow.html`. Route names and instruction text are separately configurable by the platform administrator. Unlike NeuTrauma's specialized Inbound flow, starter routes currently offer guided instructions and a **local-only draft note**; they **do not** yet store cases, run QC evaluations, or support full organization-specific workflow automation. Those are follow-on development steps. NeuTrauma-only HTML/JS and case submission are blocked for generic offices.

### Office isolation and current limitations

Employee directories, case search/detail/export, personal QC work folders, evaluations, analytics, live presence, audit history and dashboard counts are filtered by **the authenticated office ID**, never by an office ID supplied in an untrusted request. Wrong-office case IDs return not found. Office administrators can create users only within their office. Inactive offices cannot use existing sessions.

This is **version-one isolation for a local, fictional-data prototype, not a production-grade compliance boundary**. Email addresses must currently be globally unique across offices; support for the same email in multiple offices will require a later database migration. The Platform Administrator manages configuration and keys, not other clients' private case content. Production rollout also requires security review, tenant-focused penetration testing, key lifecycle controls, reliable HTTPS hosting, secure identity infrastructure, backups, and data-protection agreements. **Do not use real patient data.**

## Agent statistic cubes, QC insights and case privacy

The Analytics page is **agent-focused for everyone**. Below the graph, each agent has a compact row consisting of their name, a dot in their assigned account color, and **only three small statistic cubes** (Total, Inbound, Outbound). Resolved and Pending statistics have been removed from the Analytics interface. These figures follow the selected date, call-type and employee filters; the name-search box filters both the compact rows and graph legend.

QC-only analytics have moved **out of the shared Analytics page and into the Quality Control dashboard**:
- A small QC overview panel in `qc.html` shows evaluations, unique cases reviewed, approvals, average score, daily activity mini-chart and compact reviewer statistic cubes (total/approved/coaching/flagged).
- A 7/30/90-day picker and reviewer filter provide a quick shift overview without leaving the QC workspace. The panel auto-refreshes every 30 seconds and immediately after reviews are submitted or a case is removed/restored.
- It relies on the existing backend `GET /api/analytics/qc`, which remains **QC/Admin only** (Agents receive 403). All figures are aggregate and never include caller details.

**Case visibility is now limited to QC and administrators:**
- The `My cases` link has been removed from Inbound and hidden for Agent accounts in navigation. The old case archive page and script are **admin only**; QC reviewers manage all case records through `qc.html`.
- Agent accounts cannot read `GET /api/cases` or `GET /api/cases/:id` and receive **403 Forbidden**.
- Agent case submissions via `POST /api/cases` still work, but their responses contain only a saved flag/timestamp (or duplicate flag) — **never a Case ID**, including idempotent retries. Administrators submitting cases still receive the ID for QC.
- Inbound submission confirmation for Agents is limited to *Documentation submitted to Quality Control successfully*; no case link or ID. QC and administrators retain full case IDs, search, actions, export, saved folders, and audit history.
- No data was deleted or migrated away. Existing historic case IDs continue to be available to authorized QC/Admin users.

## Personal themes and account settings

Cricket assigns a **random, accessible accent color** to each new employee account (Agent, QC Reviewer, or Administrator). Existing accounts receive a one-time random color during the next additive database migration. The assigned color is **stored in SQLite** and is not randomized again when the employee signs in.

Every authenticated workspace has a **Settings** button in its top-right header. Employees can adjust their **own** preferences, which are saved to their account and take effect across the dashboard, Inbound, Outbound preview, My Cases, QC, Analytics, Staff and Live Operations. Choices persist through sign-outs and different computers connecting to the same Cricket server.

- **Personal color mode:** Use the assigned color, choose from eight accessible themes (Ocean, Violet, Emerald, Rose, Amber, Teal, Indigo, Coral), or click *Surprise me* for a different random color.
- **Original Cricket mode:** Restore the existing white/blue/black design instantly, without changing the saved personal color. Switch back to *My color* to recover the previous selection.
- **Layout density:** Comfortable or Compact, reducing panel and list padding.
- **Text size:** Standard, Large or Extra large (the latter two use browser-supported CSS zoom).
- **Reduce motion:** Minimize CSS transitions and animations, independently of the operating system's built-in reduced-motion preference.
- **Reset display preferences:** Restore personal color mode, comfortable density, standard text size, and standard motion while preserving the account's chosen color.

Preference API: `GET /api/preferences` and `PATCH /api/preferences` (signed-in employee only; complete validated payload `{color,mode,density,textSize,reduceMotion}`). The server binds changes to the authenticated user's ID and rejects arbitrary CSS, extra account IDs, unknown colors, and unapproved settings. Preferences are returned on login and `/api/auth/me`; users cannot modify one another's preferences. Staff Accounts shows each person's assigned color for administrators. Settings updates are included in the audit trail without private case data.

**Tip:** In this development prototype, changing visual preferences affects only the display, not workflow permissions or case contents. The original legacy theme remains available at all times.

## Interactive analytics and role-separated reporting

Open **Analytics** from the main dashboard (available to Agent, QC Reviewer, and Administrator accounts). The page shows animated, clickable SVG charts and statistics from the **shared, saved Cricket database**, not simulated or hardcoded totals.

- **Agent analytics (all roles):** Documented-case counts (Total, Inbound, Outbound), **one separate animated line for each agent**, assigned account colors, a clickable legend for showing/hiding agents, click-to-inspect daily activity, a clickable call-type breakdown and compact searchable per-agent statistic cubes. All authenticated employees may see these aggregate agent statistics. Agents who have no cases are included with zero-valued daily series. If two agents share a color, different dash patterns distinguish them.
- **QC analytics (QC Reviewer + Administrator only):** These statistics remain in the compact **QC dashboard**, not in shared Analytics. They include completed evaluations, unique reviewed cases, decisions, average scores, reviewer cubes and a small trend chart. The server returns **403 Forbidden** for `GET /api/analytics/qc` unless the session has `qc` or `admin` privileges.
- **Filters:** Past 7 / 30 / 90 UTC calendar days including today; custom date ranges (up to 366 days); agent and call type for Agent Analytics. The agent-name search also filters the displayed line series; the legend can hide/show individual agents. Clicking a chart day shows its per-agent counts, and clicking the doughnut legend filters by call type. QC reviewer and period filters remain on the QC dashboard.
- **Automatic refresh:** Analytics polls every 30 seconds when visible. Viewing a report does not extend Cricket's 20-minute inactivity timeout.
- **Statistics:** Counts reflect *documented cases* saved to Cricket and *submitted QC review records*. One case can receive multiple QC evaluations. Unique cases reviewed are de-duplicated separately. Soft-deleted cases are not counted. Outbound workflows are currently a preview; do not interpret the Outbound total as a live phone-system call counter. Numbers will normally show zero until Outbound case records actually exist.
- **Privacy:** Aggregate APIs never include caller phone numbers, notes, full case contents, or personal health information. Server authentication is required for both analytics endpoints and the page. No third-party charting service is needed.


Agent analytics API (`GET /api/analytics/agents`) now includes `agentSeries`, an ordered array of `{ id, name, color, daily: [{ date, total, inbound, outbound }] }`. All dates in the chosen UTC range are populated, even for employees with no activity. The series are computed from the same filtered case records as `totals`, `daily`, and `byAgent`; no caller numbers or case IDs are present. Other historic API fields remain available for backwards compatibility.

API routes: `GET /api/analytics/agents` (agent/qc/admin); `GET /api/analytics/qc` (qc/admin). Both use the same reporting filters as the UI.

## Live operations monitoring (multi-user demo)

Cricket now provides near-real-time status across multiple signed-in devices sharing the same **Node server and SQLite database**:

- Every authenticated employee can see an **Active agents** panel on the main dashboard and QC page. It includes employee display name, current Inbound route/stage and route duration. It never includes caller phone numbers, patient records, notes, or recordings.
- The administrator-only **Live operations** page shows connected employee sessions, their current workspace, Inbound route, active step and a live-updating route timer. It refreshes about every **4 seconds**, while the visible timer ticks every second.
- Administrators also get a live **Shift audit log** with employee and time-period filters (last 24 hours, last 7 days, full history, or activity since an employee's most recent sign-in). Events include sign-in/out, workspace changes, route transitions, documented cases, QC reviews, case removal/restoration, staff updates and exports.
- An Agent's Inbound browser reports route and step status when they change. Its heartbeat refreshes every 10 seconds; inactive or logged-out sessions disappear from the live list after a short timeout.
- All monitoring routes, permissions and the agent's identity are enforced on the backend. All employees can see basic *agent availability*, but only administrators can view the detailed monitoring and audit endpoints.
- QC reviewers can already **Remove case** from the opened case detail. Removal is soft-delete with an audit trail; administrators can restore the case from *Removed (admin)*.

**Live means near-real-time polling, not a call-center telephone integration.** A browser tab that closes or loses connectivity is marked offline after its presence heartbeat expires. Reported route duration measures time in the Cricket workflow, not the verified duration of a phone call. Never use this prototype to track real callers or employee productivity without an approved workplace policy.

## QC review productivity and session safety

- **Work Later**: Every QC reviewer and administrator has a private, persistent saved-case folder. Save or unsave a case from its detail panel. Other QC accounts do **not** see your folder.
- **Excel export (.xlsx)**: Export the selected case (including workflow actions and review history) or the filtered queue / saved folder (maximum 1,000 rows). Exports are generated locally using Node.js with no third-party packages or online spreadsheet services.
- **Quick copy buttons**: Copy the Case ID, caller number, agent, route, and other details from the QC case panel.
- **Case removal**: QC reviewers and administrators can remove a case from normal queues by typing the exact Case ID. This is an **audited, recoverable soft delete**, not permanent erasure. Administrators can view the *Removed* folder and restore cases; original notes, evaluation history, and audit evidence remain intact. Deleted cases are excluded from everyday lists and exports.
- **Sign-in enforcement**: The Node server requires authenticated sessions and proper roles before serving Inbound, QC, or staff pages; it does not trust hidden buttons. There is no guest access.
- **Idle session expiration**: Backend sessions expire after 20 minutes without a request; the browser also watches actual user interactions and signs out after 20 minutes without activity. Active user input triggers a throttled session heartbeat. The login cookie is a **browser-session cookie**, and the tab has an additional sessionStorage marker.
- **Closing Cricket**: Closing a normal tab removes its tab-scoped marker, requiring credentials to resume in a new tab. Closing the browser usually discards the session cookie as well. **Browser session restore, crash recovery, or a force-closed process can preserve session data:** browser closure cannot provide guaranteed instant server revocation. The server-side idle timeout remains authoritative; employees should also explicitly click **Sign out** before leaving a shared device.

Do not export or enter real patient phone numbers, notes, or recording details into this proof of concept. Clinical rollout requires approved hosting, policies for downloaded files, data retention, and an independent security review.

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

| Role | Inbound | Outbound (planned) | Case archive | Quality Control | Agent Analytics | QC insights | Staff accounts |
|---|---|---|---|---|---|---|---|
| Agent | Yes | Preview | No | No | Yes | No | No |
| QC Reviewer | No | No | No (use QC) | Yes | Yes | Yes (QC workspace) | No |
| Administrator | Yes | Preview | Yes | Yes | Yes | Yes (QC workspace) | Yes |

The backend **enforces** these permissions for page resources and APIs. An Inbound call now starts with a required caller number (7–15 digits with optional formatting) before the route grid is displayed. On **Start New Call** the form is reset; on **Another Inquiry — Same Call** the number stays attached.

### Existing local databases

The server runs additive SQLite migrations on startup, preserving existing users and documented cases. **Old login sessions must sign in again** after the 20-minute-idle session security migration. Legacy accounts do not automatically receive a guessed name from their email address; an administrator can use **Staff accounts → Edit name** to set their real display name. Previously documented cases correctly display “Not captured (older case)” because they did not have caller numbers.

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


## Free English live caller captions (no Azure or API keys)

Cricket uses [Faster-Whisper](https://github.com/SYSTRAN/faster-whisper) with
the free **English-only base.en model**, running on the same Windows computer
as the Cricket Node.js backend. A single persistent Python worker handles
segments. No cloud speech transcription subscription or per-minute API fee.

### One-time installation on Windows

1. Install Python 3.11 or Python 3.12 (64-bit) from
   https://www.python.org/downloads/windows/ if you do not already have one.
   Enable the Python launcher / PATH option during installation.
2. Extract the latest Cricket ZIP and open PowerShell in that Cricket folder.
3. Run the setup script:

       .\setup-captions.ps1

   This creates an isolated `.venv`, installs the pinned open-source
   `faster-whisper` dependency, and downloads the base English model to
   `data/caption-models`. **An internet connection is needed only during
   initial dependency/model download**, not for transcription after setup.
   These generated files are excluded from Git.

   If PowerShell blocks the script, run it from this same folder with:
   `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\setup-captions.ps1`.
   You do not need to change your system-wide PowerShell execution policy.
4. Start or restart Cricket:

       $env:HOST="127.0.0.1"
       $env:PORT="3001"
       npm.cmd start

5. Use the Node-hosted site at `http://127.0.0.1:3001` in Chrome or Edge.
   Sign in as an employee and open **Caller captions** inside Inbound,
   Outbound, Office Workflow, or the guided Workflow Runner.

### Use

- Confirm authorization and any recording/transcription consent before each
  call.
- Click **Start captions** and select the tab with the caller's voice.
  Select **Share tab audio** in Chrome/Edge's share dialog. Some Windows/browser
  setups also permit **Share system audio**.
- The text appears in approx. 6-second finalized segments, plus local model
  processing delay. On a slow CPU, expect higher latency; the app may skip
  segments when the engine cannot keep up.
- **Stop**, **Copy**, and **Clear** work as before. Closing the caption panel
  stops capture, and each new call requires fresh consent.

To favor speed over accuracy on a slower Windows PC, choose the smaller
English model using PowerShell in your Cricket folder:

    $env:CRICKET_CAPTIONS_MODEL="tiny.en"
    .\setup-captions.ps1
    $env:HOST="127.0.0.1"
    $env:PORT="3001"
    npm.cmd start

The selected model name must also be set each time you launch Cricket, or it
will default back to `base.en`. The `tiny.en` model downloads separately.

### Privacy and limitations

The browser does not request microphone access; a screen/video track is
required by browser sharing APIs but no screen frames are inspected or sent.
Raw audio segments travel only between the browser and Cricket's own
authenticated Node.js server, then into a local Python process. The speech
worker does **not send call audio to Azure or other speech APIs** and neither
audio nor caption text is automatically persisted by Cricket. A model download
uses Hugging Face during one-time setup, but not for inference.

This is *near-live*, English-only chunked recognition, not sub-second streaming
or speaker separation. Text may be inaccurate or lose words at segment
boundaries. Results depend on the CPU and the source application's audio
sharing compatibility. Do not transcribe actual patient-identifying data
without the required organizational, legal, and security approvals. Prefer
fictional audio when testing.

For multiple employees on different machines, a hosted production speech
service or a properly provisioned shared inference server would be needed.
This local installer is intended for the Windows development setup.
