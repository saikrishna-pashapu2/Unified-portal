# Deployment Guide

Production deployment for the ESG/Credit Portal on **AWS EC2 (Amazon Linux 2023)**.

**The production server never compiles.** GitHub Actions builds `apps/web/.next`
and publishes it as a Release asset; the server downloads it. This is not a
preference - `next build` needs 2-4 GB and the deploy runs while PM2 is still
serving the previous version, so building on a 4 GB box gets OOM-killed.

---

## Table of contents

1. [Architecture](#1-architecture)
2. [Current production](#2-current-production)
3. [Deploying a change](#3-deploying-a-change-the-common-case) ← **start here for day-to-day**
4. [Provisioning a new server](#4-provisioning-a-new-server-from-scratch)
5. [HTTPS and DNS](#5-https-and-dns)
6. [Troubleshooting](#6-troubleshooting)
7. [Known issues](#7-known-issues)

---

## 1. Architecture

```
push to main
    |
    v
GitHub Actions (build-artifact.yml)      <- 16 GB runner, throwaway postgres
    |  builds apps/web/.next
    |  publishes Release  build-<short-sha>
    v
GitHub Release asset (~7 MB, public)
    |
    |  pnpm deploy:fetch-build           <- matches the checkout's exact commit
    v
EC2 (Amazon Linux 2023)
    |
    +-- nginx  :443 --> :3000   (TLS via Let's Encrypt)
    +-- PM2
          +-- portal-web      (next start)
          +-- portal-worker   (PDF / workbook / ESG-driver / email jobs)
    |
    v
AWS RDS PostgreSQL (eu-central-1)   <- esg + credit databases
```

**Both PM2 processes are mandatory.** `portal-worker` runs all long jobs. Never
deploy or reload only `portal-web`.

### Why the artifact, not a server build

| | |
|---|---|
| `portal-web` (PM2 cap) | up to 1 GB |
| `portal-worker` (PM2 cap) | up to 2 GB |
| `next build` | +2-4 GB |
| **t3.medium total** | **4 GB** |

It cannot fit. CI has 16 GB.

---

## 2. Current production

| | |
|---|---|
| Instance | `3.73.118.249` (`eu-central-1`, Amazon Linux 2023, t3.medium) |
| SSH | `ssh -i "new.pem" ec2-user@3.73.118.249` |
| URL | https://unifiedportal.duckdns.org |
| App root | `/var/www/current` -> symlink to `/var/www/portal-vN` |
| Databases | RDS PostgreSQL, **`eu-central-1`** (same region as EC2 - keep it that way) |
| Node / pnpm | 22.x / 10.18.1 |
| Repo | https://github.com/saikrishna-pashapu2/Unified-portal (public) |

> **Region matters.** EC2 and RDS must share a region. A previous setup ran EC2
> in `me-central-1` against RDS in `eu-central-1` and paid ~100 ms cross-region
> latency on every query.

### One-time GitHub setup

**Settings -> Secrets and variables -> Actions -> Variables:**

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | `https://unifiedportal.duckdns.org` |

Next.js **inlines** `NEXT_PUBLIC_*` into the bundle **at build time**. The
workflow fails on purpose if it is unset, because the build would otherwise bake
`http://localhost:3000` into production. **If the domain ever changes, update
this variable BEFORE merging**, or the artifact ships the wrong URL.

---

## 3. Deploying a change (the common case)

### 3.1 Push and wait for the artifact

```bash
git add -A
git commit -m "your change"
git push origin main
```

Wait for **Build artifact** to go green:
https://github.com/saikrishna-pashapu2/Unified-portal/actions/workflows/build-artifact.yml

It publishes a Release tagged `build-<short-sha>`. **Do not deploy before it is
green** - the server can only fetch an artifact that exists for its commit.

### 3.2 Deploy on the server

Versioned directory + symlink, so rollback is instant. Bump `portal-vN`.

```bash
ssh -i "new.pem" ec2-user@ec2-3-73-118-249.eu-central-1.compute.amazonaws.com

cd /var/www
git clone https://github.com/saikrishna-pashapu2/Unified-portal.git portal-v2
cd portal-v2

# Reuse the existing env (never regenerate it by hand)
cp /var/www/current/.env .env
chmod 600 .env
cp .env apps/web/.env

pnpm install
pnpm db:generate
pnpm deploy:fetch-build        # NEVER run `pnpm build` here
```

`pnpm install` may report that dependency build scripts were ignored. Do not
run the interactive `pnpm approve-builds` command during a versioned production
deploy. The required Prisma clients are generated explicitly by the next step;
an ignored-build warning is not the `worker:check-db` ESM loader failure
described under Troubleshooting.

Confirm the fetch matched your commit and baked the right URL:

```
==> Artifact: build-<your-sha>
web-next.tar.gz: OK
"nextPublicApiUrl": "https://unifiedportal.duckdns.org"
==> Done. apps/web/.next is ready
```

**Fix the Prisma engine** (required until [Known issues #1](#7-known-issues) is
fixed - the artifact is built on Ubuntu, the server is RHEL-family):

```bash
cp packages/db-esg/generated/client/libquery_engine-rhel-openssl-3.0.x.so.node \
   apps/web/.next/server/
ls -la apps/web/.next/server/ | grep -i engine   # must exist
```

Apply migrations **only if there are new ones**:

```bash
set -a; source .env; set +a
DATABASE_URL="$ESG_DATABASE_URL"    pnpm -C packages/db-esg    exec prisma migrate status
DATABASE_URL="$CREDIT_DATABASE_URL" pnpm -C packages/db-credit exec prisma migrate status
```

- *"Database schema is up to date!"* -> skip migrations.
- *"...have not yet been applied"* -> see [Known issues #2](#7-known-issues) first.
- *"migration from the database is not found locally"* -> **stop the deploy**.
  The checkout has lost part of production's migration history. Never use
  `migrate reset` or `migrate resolve` to hide this in production. Restore the
  exact original migration file, compare its SHA-256 with the corresponding
  `_prisma_migrations.checksum`, and rerun `migrate status`. Proceed only when
  no database-only migration remains.

When the only remaining ESG migration is a new pending migration and the
separate migration identity is configured, apply it through the guarded script:

```bash
NODE_ENV=production pnpm db:migrate:deploy esg
DATABASE_URL="$ESG_DATABASE_URL" pnpm -C packages/db-esg exec prisma migrate status
```

Do not bypass the guarded script with the runtime database identity. If
`ESG_MIGRATION_DATABASE_URL` is missing, migration deployment is blocked until
the dedicated role is provisioned.

Verify DB connectivity before cutting over:

```bash
pnpm -C apps/web worker:check-db      # expect: database and migration check passed
```

### 3.3 Cut over

```bash
mkdir -p /var/www/portal-v2/logs
cp /var/www/current/ecosystem.config.js /var/www/portal-v2/ 2>/dev/null

pm2 delete all
cd /var/www
sudo ln -sfn /var/www/portal-v2 /var/www/current
cd /var/www/current
pm2 start ecosystem.config.js
pm2 save
```

### 3.4 Verify

```bash
pm2 status                                  # both online, restarts (↺) not climbing
curl -I http://localhost:3000               # 307 -> /esg
curl -I https://unifiedportal.duckdns.org   # 307 -> /esg
pm2 logs --lines 40 --nostream              # no prisma:error
```

Then hard-refresh the browser (**Ctrl+Shift+R**). `Failed to find Server Action`
errors right after a deploy are just cached JS from the old build.

### 3.5 Rollback

```bash
pm2 delete all
sudo ln -sfn /var/www/portal-v1 /var/www/current    # previous version
cd /var/www/current && pm2 start ecosystem.config.js && pm2 save
```

Keep the previous directory for a few days, then `sudo rm -rf /var/www/portal-v1`.

---

## 4. Provisioning a new server from scratch

Amazon Linux 2023, `ec2-user`, `dnf`. (**Not** Ubuntu/`apt`/`ubuntu` - an older
version of this guide was Ubuntu and its commands do not apply.)

### 4.1 Instance and security groups

- **t3.medium**, Amazon Linux 2023, **same region as RDS (`eu-central-1`)**
- Root volume: **30 GB** (8 GB fills up: 4 GB swap + ~2 GB node_modules)

**EC2 inbound:** 22 (your IP only), 80, 443. **Not 3000** - nginx proxies it.

**RDS inbound:** PostgreSQL 5432, source = **the EC2 security group** (not
`0.0.0.0/0`, not "all traffic"). Do this for **both** databases.

### 4.2 System

```bash
sudo dnf update -y

# Swap - stops the OOM-killer taking the app down during installs
sudo dd if=/dev/zero of=/swapfile bs=1M count=4096 status=progress
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h

# Node 22 (engines requires >=22.12.0; CI builds on 22.14.0 - majors must match)
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs
node --version

# pnpm (pinned by packageManager)
sudo corepack enable
corepack prepare pnpm@10.18.1 --activate

sudo dnf install -y git cronie
sudo systemctl enable --now crond
sudo npm install -g pm2
```

If the root volume was resized after launch:

```bash
lsblk                        # xvda 30G but xvda1 8G?
sudo growpart /dev/xvda 1    # grow the PARTITION first (note the space)
sudo xfs_growfs /            # then the FILESYSTEM
df -h /
```

### 4.3 Application

```bash
sudo mkdir -p /var/www && sudo chown ec2-user:ec2-user /var/www
cd /var/www
git clone https://github.com/saikrishna-pashapu2/Unified-portal.git portal-v1
cd portal-v1
nano .env      # see 4.4
chmod 600 .env
cp .env apps/web/.env
pnpm install
pnpm db:generate
pnpm deploy:fetch-build
cp packages/db-esg/generated/client/libquery_engine-rhel-openssl-3.0.x.so.node apps/web/.next/server/
```

### 4.4 `.env`

Copy from the running server (`cp /var/www/current/.env .env`) rather than
retyping. For a genuinely new environment:

```bash
ESG_DATABASE_URL=postgresql://USER:PASSWORD@ESG_HOST:5432/postgres?sslmode=require
CREDIT_DATABASE_URL=postgresql://USER:PASSWORD@CREDIT_HOST:5432/postgres?sslmode=require
ESG_MIGRATION_DATABASE_URL=postgresql://MIGRATOR:PASSWORD@ESG_HOST:5432/postgres?sslmode=require
CREDIT_MIGRATION_DATABASE_URL=postgresql://MIGRATOR:PASSWORD@CREDIT_HOST:5432/postgres?sslmode=require

NEXTAUTH_URL=https://unifiedportal.duckdns.org
APP_URL=https://unifiedportal.duckdns.org
NEXT_PUBLIC_API_URL=https://unifiedportal.duckdns.org
NEXTAUTH_SECRET=            # openssl rand -hex 32
CRON_SECRET=                # openssl rand -hex 32

NODE_ENV=production
PORT=3000

MAIL_SERVER=smtp.gmail.com
MAIL_PORT=587
MAIL_USERNAME=
MAIL_PASSWORD="app password with spaces MUST be quoted"
MAIL_FROM=

OPENAI_API_KEY=
OPENAI_ESG_DRIVERS_MODEL=gpt-5.4-mini
GOOGLE_API_KEY_2=
GOOGLE_CSE_ID_2=
TAVILY_API_KEY=

WORKER_CONCURRENCY=2
WORKER_EMAIL_POLL_MS=5000
WORKBOOK_WORKER_CONCURRENCY=2
```

PDF Translator requires all ESG migrations, including
`20260819090000_pdf_translation_v2` and
`20260819170000_remove_legacy_pdf_translator`, before the web or worker is
restarted.
New submissions use the `pdf_translation_v5` queue type while retaining the
existing `pdf_translation_v2_jobs` domain tables. This intentionally prevents
an older worker process from claiming a new job. After deployment, the worker
startup line must list `pdf_translation_v5`; if it does not, the old worker is
still running. The current worker also continues to drain historical v2-v4
queue rows.
It uses OpenAI PDF vision inputs and Structured Outputs one source page at a
time; it does not require OCRmyPDF/Tesseract, but the worker must have access to
`gpt-5.6-luna`. Luna is pinned in code for every extraction, translation,
retry, and validation request; there is no model environment override and no
higher-cost recovery model.
Rejected page drafts are retried with their exact validation feedback and the
previous draft, large tables fall back to row-preserving fragment translation,
and extraction alternates the one-page PDF text layer with a locally rasterized
PNG and overlapping detail strips when correction is needed. Recoverable jobs
retain compatible page checkpoints. The v5 safeguards cap automatic worker
attempts at three, extraction-stage calls at four per page (including
orientation), translation/review calls at twelve per page, and document-context
calls at two. Durable request reservations survive worker restarts; exhausted
budgets are terminal rather than restarting the full retry ladder. The output
allowance is 60,000 tokens per page and 4,000 for context, including reservations
for requests whose usage was not returned. These are per-job recovery safeguards,
not daily document quotas or an exact dollar-price guarantee.

The release adds table-index correction, rotated-page layout support and local
chart-rule detection. These are incremental improvements, not a guarantee of an
exact source replica. The tested sample still had an OCR numeric error, and its
dense page-6 table did not complete the live verification test. Automatic
orientation classification also still needs live verification. Review important
figures and chart details against the source before relying on a translation.

The application accepts PDF files up to 512 MiB (shown as 512 MB in the UI),
with 4 MiB of multipart overhead. The nginx example below therefore allows
`516M` requests specifically at `/api/pdfx-v2/upload`, while other endpoints
retain their existing `50M` proxy limit. Queue recovery
blobs expire after seven days by default (`WORKER_PDF_BLOB_RETENTION_HOURS`).
The v7 usage-event migration and automatic document-retention cleanup are not
part of this baseline.

The removal migration permanently deletes Translator 1 queue records, output
PDFs, and legacy translation history. Back up those tables before deployment
only if their retired data must be archived; Translator 2 jobs and pages are not
affected.

**`.env` syntax rules** - `set -a; source .env` is real shell, so:
- **no space after `=`** (`KEY= value` makes the value *empty*)
- **quote any value containing spaces** (`MAIL_PASSWORD="a b c d"`)

Both mistakes fail as `-bash: <word>: command not found`. If you see that, the
variable did not load. Sanity check:

```bash
set -a; source .env; set +a     # must print nothing
```

> `ESG_DATABASE_URL` / `CREDIT_DATABASE_URL` are the names the app reads.
> `DATABASE_URL_ESG` / `DATABASE_URL_CREDIT` are **not** recognized.

### 4.5 PM2

```bash
cd /var/www/portal-v1
mkdir -p logs
sudo ln -sfn /var/www/portal-v1 /var/www/current

cat > /var/www/current/ecosystem.config.js << 'EOF'
module.exports = {
  apps: [
    { name: 'portal-web', cwd: '/var/www/current', script: 'pnpm', args: '-C apps/web start',
      interpreter: 'none', env: { NODE_ENV: 'production', PORT: 3000 },
      max_memory_restart: '1G', autorestart: true },
    { name: 'portal-worker', cwd: '/var/www/current', script: 'pnpm', args: '-C apps/web worker',
      interpreter: 'none', env: { NODE_ENV: 'production' },
      max_memory_restart: '2G', autorestart: true }
  ]
}
EOF

cd /var/www/current
pm2 start ecosystem.config.js
pm2 save
pm2 startup            # then RUN the `sudo env PATH=...` line it prints
pm2 save
curl -I http://localhost:3000      # 307 -> /esg
```

`pm2 startup` only *prints* a command - you must run it, or nothing survives a
reboot.

---

## 5. HTTPS and DNS

Order matters: **nginx -> DNS -> certbot**. Certbot needs DNS already pointing
at this box to issue the certificate.

### 5.1 nginx

```bash
sudo dnf install -y nginx

sudo tee /etc/nginx/conf.d/portal.conf > /dev/null << 'EOF'
server {
    listen 80;
    server_name unifiedportal.duckdns.org;

    # Default for other uploads; PDF Translator overrides this below.
    client_max_body_size 50M;

    # PDF Translator: 512 MiB file + 4 MiB multipart envelope.
    # Keep this exception restricted to the authenticated translator endpoint.
    location = /api/pdfx-v2/upload {
        client_max_body_size 516M;
        client_body_timeout 300s;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
EOF

sudo nginx -t
sudo systemctl enable --now nginx
curl -I http://127.0.0.1 -H "Host: unifiedportal.duckdns.org"   # 307 -> /esg
```

#### Existing production server: enable 512 MB PDF uploads

Editing this guide or pulling Git changes does **not** update the running nginx
configuration. No application release/version change is required for this proxy
setting when the deployed application already has the 512 MiB file limit.

1. Inspect the active configuration with `sudo nginx -T`. Identify the portal's
   active HTTPS `server` block and its configuration file; after Certbot, it may
   differ from the original HTTP block.
2. Back up that file, then add the exact-match
   `location = /api/pdfx-v2/upload` block from the example above **inside the
   active HTTPS server block**. Update an existing exact-match upload location
   instead of adding a duplicate. Keep its proxy headers/upstream consistent
   with the portal's existing configuration. Leave other routes at `50M`.
3. Validate, then reload only if validation succeeds:

   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```

4. Verify an authenticated PDF upload larger than 50 MiB reaches the application
   without an nginx 413. Remember that submitting it creates a real translation
   job and incurs API charges. Do not trigger a full-size translation merely
   as a configuration smoke test without approval.

`client_max_body_size` limits the **whole request body**, so `512M` at the proxy
would leave no room for a maximum-size PDF's multipart envelope. The application
still rejects individual files larger than 512 MiB.
See [nginx request body size documentation](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size).

Any upstream proxy/CDN must also permit a 516 MiB request. This size setting is
not a capacity guarantee: nginx may spool uploads to temporary disk, and the
current application buffers the PDF in memory. Profile available RAM, temporary
disk and the web process's PM2 memory threshold before accepting concurrent
maximum-size uploads; the example `1G` web restart threshold above has not been
load-tested for 512 MiB PDFs. Do not disable request-size limits globally.

### 5.2 DuckDNS

The token lives in `~/duckdns/duck.sh` on any box already running the updater.

> **Stop the old server's updater first.** Its `*/5` cron re-points the domain
> back within 5 minutes and certbot then fails confusingly. On the old box:
> `crontab -e` and comment out the duckdns line (**not** `crontab -r`, which
> deletes every job).

```bash
mkdir -p ~/duckdns
nano ~/duckdns/duck.sh
```

One line - leave `ip=` **empty** so DuckDNS uses the calling machine's IP:

```bash
echo url="https://www.duckdns.org/update?domains=unifiedportal&token=YOUR_TOKEN&ip=" | curl -k -o ~/duckdns/duck.log -K -
```

```bash
chmod 700 ~/duckdns/duck.sh
~/duckdns/duck.sh
cat ~/duckdns/duck.log      # OK = success, KO = bad token/domain

(crontab -l 2>/dev/null; echo "*/5 * * * * ~/duckdns/duck.sh >/dev/null 2>&1") | crontab -
dig +short unifiedportal.duckdns.org     # must be this server's IP, and STAY there
```

### 5.3 certbot

Only once `dig` reliably returns this server's IP:

```bash
sudo dnf install -y certbot python3-certbot-nginx
sudo certbot --nginx -d unifiedportal.duckdns.org      # choose redirect HTTP->HTTPS

# Amazon Linux does NOT start this by default, despite certbot's message.
# Skip it and the cert silently expires in 90 days.
sudo systemctl enable --now certbot-renew.timer
sudo systemctl status certbot-renew.timer      # active (waiting)
sudo certbot renew --dry-run                   # simulated renewals succeeded

curl -I https://unifiedportal.duckdns.org      # 307 -> /esg
```

---

## 6. Troubleshooting

### `pnpm build` is killed / exit 137 on the server
Expected - don't build here. Use `pnpm deploy:fetch-build`.

### `deploy:fetch-build`: no artifact for this commit
The workflow hasn't finished (or failed) for your commit. Check Actions. Never
"fix" this by building locally.

### `Prisma Client could not locate the Query Engine for runtime "rhel-openssl-3.0.x"`
The engine copy step was skipped. See [Known issues #1](#7-known-issues).
Symptom in the browser: *"An error occurred in the Server Components render."*
Real error is always in `pm2 logs portal-web`.

### `The "id" argument must be of type string. Received type number`
A worker thread got a webpack module id instead of a path. See
[Known issues #3](#7-known-issues).

### Site loads but shows a server error
```bash
pm2 logs portal-web --lines 80 --nostream
```
Next hides details in production; PM2 logs have the real stack.

### DB connection hangs / times out
RDS security group must allow 5432 from the EC2 security group. Test:
```bash
pnpm -C apps/web worker:check-db
```

### `Failed to find Server Action "..."`
Cached JS from the previous build. Hard-refresh (Ctrl+Shift+R). Harmless.

### Disk full
```bash
df -h /
sudo growpart /dev/xvda 1 && sudo xfs_growfs /
sudo rm -rf /var/www/portal-vOLD        # old releases
pm2 flush                                # old logs
```

### Reboot lost everything
`pm2 startup` printed a command that was never run. Re-run it, then `pm2 save`.

---

## 7. Known issues

1. **Prisma engine must be copied by hand after every fetch.**
   `binaryTargets` in both `packages/db-*/prisma/schema.prisma` is
   `["native", "debian-openssl-3.0.x"]`. CI runs Ubuntu, so `native` = debian
   and **no RHEL engine is ever built**; Amazon Linux needs
   `rhel-openssl-3.0.x`. `next.config.js` sets
   `transpilePackages: ['@esgcredit/db-esg', ...]`, so the Prisma client is
   bundled into `.next` and ignores the server's own `pnpm db:generate`.
   **Fix:** add `"rhel-openssl-3.0.x"` to `binaryTargets` in both schemas, then
   drop the copy step.

2. **Migration identities must be provisioned.** `db:migrate:deploy` requires
   `ESG_MIGRATION_DATABASE_URL` / `CREDIT_MIGRATION_DATABASE_URL` (a *separate*
   role from the runtime one) when `NODE_ENV=production`. A deployment with a
   pending migration must stop if the corresponding value is absent. Never
   work around the guard by assigning the runtime URL to the migration variable;
   provision an app role and a separate migrator role instead.

3. **Excel export is broken** (`The "id" argument must be of type string`).
   `lib/workbook.ts` passes `require.resolve("xlsx")` into a worker thread;
   webpack rewrites it to a numeric module id and the worker does
   `require(78365)`. **Fix:** add `'xlsx'` to `serverExternalPackages` in
   `next.config.js`.

4. **`pnpm prod:check` is stale** - it demands `DATABASE_URL_ESG` /
   `DATABASE_URL_CREDIT`, which the app does not use (it reads
   `ESG_DATABASE_URL` / `CREDIT_DATABASE_URL`). It fails even on a correct
   `.env`. Don't add those aliases to work around it; fix the script.

5. **`output: 'standalone'` + `next start` is unsupported.** Next logs
   `"next start" does not work with "output: standalone"`. It works today, but
   the option only benefits Docker and adds ~168 MB of unused build output.
   Since PM2 runs `next start`, remove it from `next.config.js`.

6. **`ci.yml` has never run.** It is a good gate (postgres service, migrations,
   type-check, lint, tests, e2e) but is untracked, so nothing blocks a bad
   commit from reaching `main`. It also sets `OPENAI_API_KEY` only for
   `prod:check`, not for the build - so its build step would fail the same way
   `build-artifact.yml` did until placeholders were added.

---

## Appendix: why the build needs a database and fake API keys

`next build` does more than compile:

- Both Prisma clients **throw at import time** if their URL is unset, and Next
  imports every API route while collecting page data.
- Several tender-processing modules run `new OpenAI(...)` at **module scope**,
  so those keys must be *present*.
- `/credit/publications` executes `prisma.$queryRaw()` during prerender, so a
  reachable, migrated database is genuinely required.

That is why `build-artifact.yml` starts a throwaway `postgres:17` and passes
placeholder keys, and why the old runbook copied `.env` before building.

**Placeholders cannot leak into the artifact.** Next inlines only
`NEXT_PUBLIC_*`; every other value stays a runtime `process.env` lookup that the
server resolves from its own `.env` at start.
