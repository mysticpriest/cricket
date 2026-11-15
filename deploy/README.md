# Cricket — demonstration hosting runbook

## What is live and what is not

**Public showcase:** `demo/index.html` is a self-contained, fictional, interactive product tour hosted on your configured GitHub Pages site. It uses no backend and never collects or transmits user information. The existing project-site root redirects to the tour only when accessed on the GitHub Pages domain. GitHub Pages cannot run Node.js, SQLite, login sessions, APIs, WebRTC signaling or Connect message delivery.

**Authenticated staging:** `Dockerfile`, `docker-compose.yml`, and `deploy/Caddyfile` prepare a **single-server staging instance** of the real Cricket application over automatic HTTPS. This is for controlled demonstrations with fictitious users and sample data, not for real healthcare information or paying customers. Deploying the container still requires a cloud/VM account, a domain, DNS setup and hosting fees. These files do not create external cloud resources automatically.

## Public showcase

The expected link for this repository's standard GitHub Pages project URL is:

`https://mysticpriest.github.io/cricket/demo/`

The project homepage `https://mysticpriest.github.io/cricket/` redirects there on the GitHub Pages hostname. Verify the actual Pages URL in **GitHub → Repository → Settings → Pages → Visit site**. Pages must be publishing the main branch root for these paths to work. No user accounts or login are needed. The GitHub Pages deployment action is separate from the Node backend; a successful Pages build means static assets were published, not that the full app is live.

## Deploy the complete app to one HTTPS staging host

Recommended temporary architecture: **one Ubuntu VM with a locally attached persistent disk**, Docker Compose, and a domain such as `staging.example.com`. This is compatible with an Azure Virtual Machine and Azure managed disk, but a cloud account, billing permissions, VM/DNS and firewall configuration are required. You can also run the same Compose bundle on a single dedicated Linux machine.

1. Create a VM with enough memory and a persistent local disk. Create a domain DNS A record pointing to its public IP. Keep SSH secured. Allow inbound TCP **80 and 443 only** for the application; do not publish port 3001 or the SQLite volume. Configure VM OS updates and firewall rules. The VM provider charges for compute, disk and transfer.
2. Install Docker Engine with the Compose plugin using Docker's official provider-specific instructions. Clone or upload the Cricket repository to a private directory on the VM.
3. In the repository root, run `cp deploy/env.template .env`, then edit `.env` with a real domain and independently generated, high-entropy passwords and office keys. Never commit `.env` or send credentials to other people. Don't use example strings or reused credentials.
4. Run `docker compose config` to validate interpolation and `docker compose up -d --build` to start the service. Inspect status with `docker compose ps` and logs with `docker compose logs --tail 100 cricket proxy`.
5. Caddy obtains a real HTTPS certificate when DNS and ports are correct. Open `https://your-domain.example`. Select the platform office key, sign in as your platform administrator, and create an example client with **fictional** employee accounts. Use the platform's module switches to demonstrate different plans.
6. Test access on two external devices. Test Inbound/Outbound workflow capture, QC review, employee account limits, and Connect messages. WebRTC voice/video may require your own TURN server when direct connectivity fails. See `README.md` for Connect ICE configuration.
7. Keep the environment **single-instance** while SQLite and SSE signaling are in-process. Back up the persistent named volume `cricket_data` regularly, using a SQLite-consistent backup (do not copy a live WAL database file blindly), and test restoration. Never run `docker compose down -v` unless deliberately deleting all staging data.

**Important limitations**

- Real patient or regulated data is prohibited for this staging release. HIPAA readiness, penetration testing, legal agreements, audit/compliance review, billing and privacy disclosures are not complete.
- SQLite on a network-mounted or shared cloud filesystem is not a robust production database. In particular, Azure App Service's shared `/home` network storage is **not** a suitable SQLite volume for this application. Run the existing single-process stage on local VM disk, or migrate persistence to a managed relational database before choosing multi-instance PaaS.
- Connect uses per-process SSE and in-memory call signaling. Redis/event-bus fan-out and a reliable TURN relay are needed for horizontally scaled real-time communications.
- The public demo is intentionally simulated. It must never be mistaken for live operational analytics or a completed paid subscription.
- Containers are prepared for staging, not yet provisioned in Azure or another provider. No domain, cloud subscription, or real compute has been created by this repository change.

## Next production engineering milestones

Before a commercial SaaS launch, prioritize managed relational persistence (PostgreSQL or Azure SQL), database migrations and tested backup/restore, hardened tenant isolation, secure customer onboarding, audit trails, billing-provider integration, dedicated staging/production environments, monitored CI/CD releases, distributed Connect signaling and TURN, accessibility testing and documented incident response.

Avoid marketing claims of HIPAA certification, compliant patient communications, enterprise SLAs or fully production-ready subscriptions until those capabilities are independently assessed and verified.
