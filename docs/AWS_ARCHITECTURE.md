# AWS architecture (Phase 7B design — nothing created)

**Status: design for review. No AWS account, resource, credential or deployment job exists or was used.** It
deploys the two images from `docs/DOCKER_SETUP.md`. Costs: `docs/AWS_COST_ESTIMATE.md`; pipeline:
`docs/AWS_CICD_PLAN.md`. Render and Vercel stay live and unchanged until an approved cutover.

## 1. Recommendation in one paragraph

Region **eu-west-2 (London)**. One VPC across two Availability Zones. An internet-facing **Application Load Balancer**
with an **ACM** certificate terminates HTTPS and forwards to an **ECS Fargate** service whose tasks run **two
containers — storefront and API — sharing the task's network namespace** (the storefront calls the API on
`127.0.0.1`). **RDS for PostgreSQL 17** sits in isolated subnets reachable only from the tasks. Images in **ECR**
(immutable tags, scan on push), configuration secrets in **Secrets Manager**, logs and alarms in **CloudWatch**,
exported backups in **S3**. Schema migrations run as a **one-off ECS task** before each service update. Staging
(Option A) is the same shape at minimum size; production (Option B) adds a second task, Multi-AZ RDS, private
subnets with NAT, WAF and longer retention.

## 2. Region

| | London eu-west-2 | Ireland eu-west-1 |
| --- | --- | --- |
| Data location | United Kingdom — simplest for UK GDPR, no restricted transfer question | Republic of Ireland (EU); UK→EU transfers are covered by the UK adequacy regulations, but it is outside the UK |
| Latency for UK shoppers | lowest | typically ~10 ms more |
| Monthly cost (`AWS_COST_ESTIMATE.md`) | Option A $76.47, Option B $304.74 | Option A $71.67, Option B $286.22 |
| Services used here | all available | all available |

**Choose London.** The store's customers, currency and time zone are British; the price difference is about 6 % ($5
staging, $19 production per month). The 2026-11 price lists confirm every service above is offered in eu-west-2.

## 3. Network

```
                    Internet
                       │ 443 (80 → 301 to 443)
              ┌────────▼─────────┐  ACM certificate, optional AWS WAF (production)
              │ ALB (public subnets, AZ a + b)
              └────────┬─────────┘  target group: IP targets :3000, health check /robots.txt
   ┌───────────────────┼──────────────────────────────┐
   │ ECS Fargate task (awsvpc: one ENI, one network namespace)
   │   web  (Next.js :3000, essential, dependsOn api HEALTHY)
   │     └─ /api/* → http://127.0.0.1:4000
   │   api  (Express :4000, essential, health check /readyz)
   └───────────────────┬──────────────────────────────┘
                       │ 5432 (TLS)
              ┌────────▼─────────┐
              │ RDS PostgreSQL 17 (isolated subnets, AZ a + b subnet group)
              └──────────────────┘
```

| Subnets (VPC 10.20.0.0/16) | AZ a | AZ b | Route to the internet |
| --- | --- | --- | --- |
| public | 10.20.0.0/24 | 10.20.1.0/24 | internet gateway (ALB; NAT gateways in production) |
| app (private in production) | 10.20.10.0/24 | 10.20.11.0/24 | production: NAT gateway in the same AZ; staging: tasks run in the public subnets instead, with a public IPv4 and no inbound rule except from the ALB |
| data (isolated) | 10.20.20.0/24 | 10.20.21.0/24 | none |

**Why tasks need outbound access at all:** pulling images from ECR, sending logs, reading secrets, and — during the
migration only — reaching the production MongoDB for the reconciliation tools. In production, NAT gateways (one per
AZ, $73/month for two) or interface VPC endpoints for `ecr.api`, `ecr.dkr`, `logs` and `secretsmanager` plus the free
S3 gateway endpoint ($64/month across two AZs) provide it. NAT is recommended while MongoDB must be reachable; after
MongoDB is retired, endpoints alone can replace NAT. **Staging avoids both** by running its single task in a public
subnet with a public IPv4 ($3.65/month) and a security group that admits only the ALB.

### Security groups

| Group | Inbound | Outbound |
| --- | --- | --- |
| `alb` | 443 and 80 from 0.0.0.0/0 and ::/0 | 3000 to `app` |
| `app` (tasks) | 3000 from `alb` only (4000 is never opened: the API is reached over loopback) | 5432 to `data`; 443 to 0.0.0.0/0 (ECR, logs, secrets; MongoDB during migration — narrow to the provider's addresses when known) |
| `migrate` (one-off task) | none | 5432 to `data`; 443 as above |
| `data` (RDS) | 5432 from `app` and `migrate` | none |

## 4. Why one task with two containers (and when to split)

The storefront **refuses a plain-HTTP `BACKEND_ORIGIN` unless it is a loopback address**
(`apps/web/src/lib/env/parse.ts`), so cookies and CSRF tokens never cross a network unencrypted. In one Fargate
task both containers share the task's ENI, so `http://127.0.0.1:4000` is loopback and the rule holds without
internal TLS. It also means the API has **no network path from the load balancer at all**, and no second load
balancer is paid for. The cost is coupled scaling (each task carries one of each) — appropriate while one API
instance per storefront instance is enough.

**Splitting into two ECS services** (independent scaling) needs HTTPS to the API: an internal ALB (~$25/month) with
an ACM certificate for a name such as `api.internal.<domain>` (a public certificate validated by DNS, resolved via a
Route 53 private hosted zone) and `BACKEND_ORIGIN=https://api.internal.<domain>`. No code change; revisit when the
API needs more instances than the storefront. ECS Service Connect with TLS would need AWS Private CA ($50–$400 a
month), so it is not proposed.

## 5. ECS

| Setting | Staging (A) | Production (B) |
| --- | --- | --- |
| Task size | 0.5 vCPU, 1 GB (web 512 MB, api 384 MB soft limits) | 1 vCPU, 2 GB |
| Desired / min / max tasks | 1 / 1 / 1 | 2 / 2 / 4 (target tracking on CPU 60 % and ALB requests per target) |
| Placement | 1 task | spread across AZ a and b |
| Root filesystem | `readonlyRootFilesystem: true` for both containers; web gets an ephemeral volume at `/app/.next/cache` | same |
| User / capabilities | uid 65532 from the image; `linuxParameters.capabilities.drop: ["ALL"]`; no privileged mode (Fargate never allows it) | same |
| Stop | `stopTimeout` 30 s (> API `SHUTDOWN_TIMEOUT_MS` 10 s); ALB deregistration delay 30 s | same |
| Container health | api: `/nodejs/bin/node -e fetch(…/readyz)`; web: `/robots.txt`; web `dependsOn` api `HEALTHY` | same |
| ECS Exec | allowed for staging debugging | disabled |
| Platform | `LINUX/X86_64` (ARM64 saves ~20 % on Fargate; needs `linux/arm64` builds) | same |

**Migrations:** before a service update the pipeline runs a one-off task from the same API image with the command
`["dist/scripts/dbMigrate.js", "up"]` in the `migrate` security group, waits for exit code 0, then updates the
service. The API never migrates at start-up and refuses to start if the schema is behind (`verifySchemaCurrent`).
Migrations must stay backward-compatible with the running version during a rolling deployment
(expand-then-contract), because old and new tasks overlap.

**Deployments:** rolling, `minimumHealthyPercent` 100, `maximumPercent` 200, **deployment circuit breaker with
automatic rollback**, plus CloudWatch alarms on 5xx rate and target health attached to the deployment. Rollback =
redeploy the previous task definition revision (same image digest), which is immutable.

## 6. HTTPS, forwarded headers, cookies and CSRF

- ALB: HTTPS listener with an ACM certificate (TLS policy `ELBSecurityPolicy-TLS13-1-2-2021-06`), HTTP listener
  redirecting to HTTPS, `routing.http.drop_invalid_header_fields.enabled = true`. HSTS should be sent by the app
  (`Strict-Transport-Security` in `next.config.ts` headers) — a 7C change.
- **Cookies:** the API issues the `__Host-ecom_session` cookie (Secure, HttpOnly, SameSite=Lax, host-only) through
  the storefront's proxy; the browser sees HTTPS, so Secure cookies work although the hop from the ALB to the task is
  HTTP inside the VPC. `AUTH_ALLOWED_ORIGINS` = the public storefront origin exactly (for example
  `https://staging.<domain>`). CSRF stays as built: Origin check plus the `X-CSRF-Token` header.
- **Client addresses for rate limits — 7C code change required.** The ALB *appends* the client address to
  `X-Forwarded-For`; anything the client sent stays in front of it. The storefront's `TRUSTED_CLIENT_IP_HEADER` reads a
  header's whole value and expects a header the platform *overwrites* (Vercel's `x-real-ip`), so on AWS it cannot be
  pointed at `X-Forwarded-For` as is: per-IP limits would see the task's own address for every visitor. Needed: read
  the right-most `X-Forwarded-For` entry (the one the ALB added) when configured for one trusted hop, with tests; then
  `TRUSTED_CLIENT_IP_HEADER=x-forwarded-for` and `PROXY_CLIENT_IP_SECRET` from Secrets Manager. The API keeps
  `TRUST_PROXY_HOPS=0` (it only ever sees the storefront on loopback).
- **Staging cookie-session allowance — 7C code change required.** It currently requires `RENDER_SERVICE_NAME` ending
  in `-staging`, a value Render sets. ECS has no equivalent; staging on AWS needs a reviewed, tested change that
  accepts an ECS-specific signal (for example the cluster name read from the task metadata endpoint ending in
  `-staging`) alongside the other four conditions. **Production keeps refusing cookie sessions**; lifting that is a
  separate, approved change (R30).

## 7. Next.js behind a load balancer

- **Data cache across instances.** The storefront caches the catalogue for 60 s and an admin change calls
  `revalidateTag("catalog")`. With more than one task, that only clears the cache of the task that handled the
  admin request: other tasks may show the old price or a deleted product for up to 60 s. Options: accept up to 60 s
  (staging; the API still enforces current prices and stock at checkout), a shared cache handler (ElastiCache,
  ~$12+/month, code change), or no data cache for the catalogue (more API load). Decision for production in 7C.
- **Version skew during rolling deployments.** Old and new tasks serve at the same time; a browser holding the old
  build can request `/_next/static/<old hash>` from a new task (404). Mitigations, in order: set a per-build
  `deploymentId` so Next.js hard-reloads on mismatch; ALB stickiness for the overlap; for production, serve
  `/_next/static` from S3 + CloudFront with all builds' immutable files kept for a few days.
- Image optimiser cache: per task, ephemeral; acceptable.

## 8. Database

- RDS for PostgreSQL 17 (the version the migrations are tested on), gp3, encryption at rest (AWS-managed key in
  staging, customer-managed KMS key in production), deletion protection, `rds.force_ssl=1` (default since 15).
- **TLS from the API — 7C change required:** the image does not contain the RDS CA bundle; add
  `global-bundle.pem` to the API image and use `sslmode=verify-full` with `sslrootcert` in `DATABASE_URL`.
- Users: the master user (RDS-managed secret with rotation) only for administration; an application role without
  DDL rights for the API; a migration role with DDL for the `migrate` task.
- **Connections:** `PG_POOL_MAX` 10 per task. db.t4g.micro allows roughly 80–110 connections, db.t4g.small roughly
  190–220 (`LEAST(memory/9531392, 5000)` minus reserved). Production at 4 tasks × 10 + migrations + operators stays
  well under. RDS Proxy (billed per vCPU of the database) only if task counts grow a lot.
- Backups: automated backups 7 days (staging) / 14 days (production) with point-in-time recovery; a manual snapshot
  before every migration; production snapshots copied to eu-west-1 by AWS Backup for disaster recovery; logical
  `pg_dump` exports to S3 (versioning, Object Lock in governance mode, lifecycle to cheaper storage after 30 days).
  Targets: RPO ≤ 5 minutes (PITR), RTO ≤ 1 hour within the region; region loss: restore the copied snapshot in
  Ireland (RPO up to 24 h), documented as a manual runbook.

## 9. Secrets and configuration

| Secret (Secrets Manager) | Used by | Rotation |
| --- | --- | --- |
| `…/database/app-url` (JSON key with the full `DATABASE_URL`) | api | Rotating the password needs a new deployment (the value is read at task start); a 7C option is accepting `PGHOST`/`PGUSER`/`PGPASSWORD` separately so RDS-managed rotation can be referenced key by key |
| `…/database/migrate-url` | migrate task | same |
| `…/app/jwt-secret` | api | manual, with a deployment; invalidates legacy tokens |
| `…/app/proxy-client-ip-secret` | web, api | manual, both containers in one deployment |

Injected with the task definition's `secrets` (`valueFrom` = secret ARN and JSON key). The **execution role** may
read exactly these ARNs and decrypt with the one KMS key; the **task role** has no permissions (the application
makes no AWS API calls). Non-secret settings (`DATA_SOURCE_*`, `AUTH_*`, `PG_*`, `NODE_ENV`, `BACKEND_ORIGIN`) are
plain task-definition environment values, reviewed in Git.

## 10. Observability

`awslogs` driver to one log group per service and environment (retention 30 days staging, 90 days production).
Alarms (SNS e-mail): ALB 5xx rate > 1 % for 5 minutes, unhealthy targets > 0 for 5 minutes, ECS CPU or memory > 80 %,
RDS CPU > 80 %, free storage < 20 %, connections > 80 % of the maximum, deployment circuit-breaker rollback. Container
Insights optional (billed per metric). Logs never contain session tokens or secrets (verified locally).

## 11. Minimum viable staging (Option A)

VPC with public + data subnets in two AZs; ALB + ACM certificate; one ECS cluster `ecommerce-staging`, one
service with one task; RDS db.t4g.micro Single-AZ, 20 GB, 7-day backups; two ECR repositories; Secrets Manager
entries; log groups and five alarms; Route 53 record (or the existing DNS provider). Seeded with the test catalogue
or a sanitised copy — **never** production data. Can be scaled to zero tasks and the database stopped (up to 7 days at
a time) when unused.

## 12. Prerequisites before anything is created (Phase 7C)

1. Owner approval, an AWS account with MFA on the root user, a budget alarm, and the region decision.
2. Code changes (each reviewed and tested): client address from the ALB (§6), staging allowance on ECS (§6), RDS TLS
   (§8), HSTS header (§6), and the pending dependency updates (mongoose, Next.js).
3. Infrastructure as code (Terraform or AWS CDK) for everything above, reviewed before the first `apply`.
4. GitHub OIDC roles for staging only (`docs/AWS_CICD_PLAN.md`).
