# Copilot Instructions - ESG/Credit Portal

## Project Architecture

This is a **dual-domain portal** built with Next.js 14 (App Router) using pnpm workspaces. The application serves two separate domains (ESG and Credit) with shared infrastructure but domain-specific content, routing, and theming.

### Workspace Structure
- **Monorepo**: pnpm workspace with `apps/web` (Next.js) and `packages/db-*` (Prisma clients)
- **Two databases**: Separate PostgreSQL instances via `@esgcredit/db-esg` and `@esgcredit/db-credit` packages
- **Domain routing**: URL pattern `/{domain}/articles`, `/{domain}/events`, etc. where domain is `esg` or `credit`

### Key Patterns

**1. Domain-Based Data Access**
```typescript
// Always use getPrisma() helper for domain-specific queries
import { getPrisma, Domain } from "@/lib/db";
const prisma = getPrisma(domain); // Returns esgPrisma or creditPrisma
```

**2. Route Params Convention**
All domain-specific pages follow this pattern:
```typescript
export default async function Page({ params }: { params: { domain: 'esg' | 'credit' } }) {
  const domain = params.domain; // Type-safe domain access
}
```

**3. Authentication & Team Assignment**
- Uses NextAuth with credentials provider
- Users have a `team` field ('esg' or 'credit') stored in session
- Middleware protects routes: `/esg/*`, `/credit/*`, `/profile`, `/admin/*`
- Admin check: `(session as any).is_admin` boolean in token/session

**4. Database Package Pattern**
- Each Prisma client lives in `packages/db-{domain}/generated/client`
- Import as: `import { esgPrisma } from '@esgcredit/db-esg'`
- Must run `pnpm db:generate` after schema changes

## Critical Workflows

### Development
```bash
pnpm dev                    # Start Next.js dev server (port 3000)
pnpm db:generate            # Regenerate both Prisma clients
pnpm db:studio:esg          # Open Prisma Studio for ESG DB
pnpm db:studio:credit       # Open Prisma Studio for Credit DB
pnpm build                  # Production build (runs db:generate first)
```

### Database Migrations
```bash
# In packages/db-esg or packages/db-credit
pnpm pull                   # Pull schema from live DB
pnpm generate               # Generate Prisma client
```

### Background Jobs
- **Alert scheduler**: Runs via `instrumentation.ts` (Node.js runtime only)
- Uses `node-cron` for scheduling (every 5 minutes)
- No external cron needed - built into Next.js app
- Endpoints: `/api/cron/process-alerts`, `/api/cron/process-queue`

### Deployment (EC2)
```bash
# Production deployed on EC2 with PM2
cd /var/www/portal-v1.0.0
git pull
pnpm install
pnpm build
pm2 restart all
```

## Domain-Specific Features

### Tender System (ESG Only)
- **Scraper**: `apps/web/src/lib/tenders/scraper.ts` - scrapes mitwork.kz every 3 hours
- **Translator**: OpenAI GPT-4o-mini for Russian/Kazakh → English
- **Classifier**: AI-based ESG/Credit relevance scoring with keyword matching
- Manual trigger: `POST /api/admin/tenders/scrape`
- Tables: `tenders`, `tender_sources`, `tender_keywords`, `tender_classifications`

### AI Article Assistant
- **LangGraph-based agent**: `apps/web/src/lib/article-assistant-agent.ts`
- Tools: web_search (Tavily API), generate_chart
- Streaming responses via OpenAI GPT-4o-mini
- Tracks conversations in `article_conversations` and `article_messages` tables
- Usage tracked with tokens/cost in USD

### Alert System
- **3 types**: immediate, daily digest, weekly digest
- Multi-domain support: alerts can track ESG, Credit, or both
- Keywords stored as arrays in `alert_preferences.keywords`
- Email queue: `email_queue` table with status tracking
- Scheduler: `apps/web/src/lib/alert-scheduler.ts`

### PDF Translation Tool
- **PDFx**: Extract text → OCR fallback (Tesseract.js) → OpenAI translation
- Job tracking in memory (not persisted across restarts)
- Supports 17 languages
- Routes: `/api/pdfx/*`

## Code Conventions

### Prisma Queries
```typescript
// Use domain-aware helper for cross-domain compatibility
const articles = await getPrisma(domain).articles.findMany({...});

// Direct import when domain is known at compile time
import { esgPrisma } from '@esgcredit/db-esg';
const users = await esgPrisma.users.findUnique({...});
```

### Server Components (Default)
- All pages are async server components unless marked `"use client"`
- Use `getServerSession(authOptions)` for auth in server components
- API routes use `export const runtime = "nodejs"` explicitly

### API Route Pattern
```typescript
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Access: (session as any).team, (session as any).is_admin
}
```

### Revalidation
- Use `export const revalidate = 300` (5 min) or `0` (always fresh) per page
- Dynamic routes: `export const dynamic = "force-dynamic"` for API routes with real-time data

## Environment Setup

### Required Variables
```bash
# Database (both domains)
DATABASE_URL=           # ESG DB (primary)
ESG_DATABASE_URL=       # ESG DB (explicit)
CREDIT_DATABASE_URL=    # Credit DB

# Auth
NEXTAUTH_SECRET=
NEXTAUTH_URL=

# OpenAI & APIs
OPENAI_API_KEY=
TAVILY_API_KEY=         # For web search tool

# Email
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=

# Cron
CRON_SECRET=            # Protect cron endpoints
```

### Prisma Client Generation
Each DB package needs `.env` with `DATABASE_URL` before `pnpm generate`:
- `packages/db-esg/.env`
- `packages/db-credit/.env`

## Testing Endpoints

```bash
# Trigger tender scraping
curl -X POST http://localhost:3000/api/admin/tenders/scrape \
  -H "Content-Type: application/json" \
  -d '{"source":"mitwork_kz"}'

# Test daily digest email
curl -X POST http://localhost:3000/api/admin/test-daily-digest

# Check AI Assistant stats
curl http://localhost:3000/api/admin/ai-assistant/stats?days=7&domain=esg
```

## Common Gotchas

1. **Domain routing**: Always check `params.domain` type - it's `'esg' | 'credit'`, not a string
2. **Database selection**: Don't mix `esgPrisma` and `creditPrisma` queries in cross-domain features
3. **Middleware auth**: Routes outside `/esg/*` and `/credit/*` are public unless explicitly protected
4. **Prisma generation**: Must run `pnpm db:generate` in root after any schema changes
5. **Instrumentation**: Only runs in Node.js runtime (not Edge) - check `process.env.NEXT_RUNTIME`
6. **Transpilation**: Both DB packages must be in `transpilePackages` in `next.config.js`

## File Locations Reference

- Auth config: `apps/web/src/lib/nextauth-options.ts`
- DB helper: `apps/web/src/lib/db.ts`
- Middleware: `apps/web/src/middleware.ts`
- Background jobs: `apps/web/src/instrumentation.ts`
- Tender system: `apps/web/src/lib/tenders/`
- AI Assistant: `apps/web/src/lib/article-assistant-agent.ts`
- Alerts: `apps/web/src/lib/alert-scheduler.ts`
