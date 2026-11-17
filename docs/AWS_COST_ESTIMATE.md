# AWS cost estimate (Phase 7B — nothing created, nothing billed)

**Source of every price:** AWS Price List bulk files (`https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/<service>/current/<region>/index.json`),
on-demand USD, publication dates 2026-11-08 to 2026-11-17 (WAF 2026-09-14), downloaded 2026-11-17. Monthly = 730
hours. Excludes VAT, support plans, Savings Plans / reserved instances and promotional credits. **Nothing here is
claimed to be free-tier eligible**; where the price list itself shows a $0 tier (data transfer, logs, alarms), the
estimate says so and does not rely on it unless stated. Architecture: `docs/AWS_ARCHITECTURE.md`.

## Unit prices used

| Service (usage type) | London eu-west-2 | Ireland eu-west-1 |
| --- | ---: | ---: |
| Fargate Linux x86 vCPU-hour / GB-hour | $0.04656 / $0.00511 | $0.04048 / $0.004445 |
| Fargate ARM vCPU-hour / GB-hour | $0.03725 / $0.00409 | $0.03238 / $0.00356 |
| Application Load Balancer hour / LCU-hour | $0.02646 / $0.0084 | $0.0252 / $0.008 |
| NAT gateway hour / GB processed | **$0.05 / $0.05** | $0.048 / $0.048 |
| Public IPv4 address in use, per hour | $0.005 | $0.005 |
| Interface VPC endpoint hour (per AZ) / GB | $0.011 / $0.01 | $0.011 / $0.01 |
| RDS PostgreSQL db.t4g.micro Single-AZ / Multi-AZ, hour | $0.018 / $0.036 | $0.017 / $0.035 |
| RDS PostgreSQL db.t4g.small Single-AZ / Multi-AZ, hour | $0.036 / $0.072 | $0.035 / $0.069 |
| RDS PostgreSQL db.t4g.medium Multi-AZ, hour | $0.145 | $0.138 |
| RDS gp3 storage GB-month Single-AZ / Multi-AZ | $0.133 / $0.266 | $0.127 / $0.254 |
| RDS backup storage beyond the free allocation, GB-month | $0.10 | $0.095 |
| RDS T4g CPU credits (unlimited mode, only when the baseline is exceeded), vCPU-hour | $0.075 | — |
| CloudWatch Logs ingestion / storage, GB | $0.5985 / $0.0315 | $0.57 / $0.03 |
| CloudWatch alarm (standard) / custom metric, month | $0.10 / $0.30 | $0.10 / — |
| Secrets Manager secret-month / 10,000 API calls | $0.40 / $0.05 | $0.40 / $0.05 |
| ECR storage GB-month | $0.10 | $0.10 |
| S3 Standard GB-month (first 50 TB) | $0.024 | $0.023 |
| KMS customer managed key-month / 10,000 requests | $1.00 / $0.03 | $1.00 / $0.03 |
| Route 53 hosted zone-month / million queries | $0.50 / $0.40 (global) | same |
| AWS WAF web ACL / rule / million requests | $5.00 / $1.00 / $0.60 | $5.00 / $1.00 / $0.60 |
| Data transfer out to the internet, GB (first 10 TB) | $0.09 | $0.09 |

Price-list $0 tiers seen, not relied on unless stated: data transfer out 100 GB/month "aggregated globally"; Logs
first 5 GB ingested and stored; first 10 alarms and 10 metrics (these are account-wide allowances). ACM: the price
list contains **no line for public certificates** — only AWS Private CA ($400/month, short-lived mode $50/month) and
private certificates; public ACM certificates on a load balancer are therefore not charged, and Private CA is not
used in this design.

## Option A — low-cost staging (learning, deployment verification, limited testing)

One task (storefront + API containers), one ALB, RDS db.t4g.micro Single-AZ, **no NAT gateway** (the task runs in a
public subnet with a public IPv4 and a security group that admits only the ALB), 7-day backups.

| Item | London (eu-west-2) | Ireland (eu-west-1) |
| --- | ---: | ---: |
| Fargate: 1 task, 0.5 vCPU / 1 GB (storefront + API containers), x86, 24×7 | $20.72 | $18.02 |
| Application Load Balancer: 730 h | $19.32 | $18.40 |
| ALB capacity: 1 LCU average (assumption) | $6.13 | $5.84 |
| RDS PostgreSQL db.t4g.micro Single-AZ | $13.14 | $12.41 |
| RDS gp3 storage 20 GB | $2.66 | $2.54 |
| Public IPv4: 2 (ALB, one per AZ) + 1 (task in a public subnet, no NAT) | $10.95 | $10.95 |
| CloudWatch Logs: 1 GB ingested + 1 GB stored | $0.63 | $0.60 |
| CloudWatch alarms: 5 | $0.50 | $0.50 |
| Secrets Manager: 4 secrets (app and migrate database URLs, JWT, proxy secret) | $1.60 | $1.60 |
| ECR: 2 GB of images | $0.20 | $0.20 |
| Route 53: 1 hosted zone (optional if DNS stays elsewhere) | $0.50 | $0.50 |
| S3: 5 GB of exported backups | $0.12 | $0.11 |
| **Total per month** | **$76.47** | **$71.67** |

Ways to spend less on staging: ARM64 task $16.58 instead of $20.72; scale the service to 0 and stop the database
outside test days (an RDS instance can be stopped for up to 7 days at a time; storage, the ALB and IPv4 addresses
still bill: $31.70/month with everything idle — ALB $19.32, its two IPv4 addresses $7.30, database storage
$2.66, secrets $1.60, hosted zone $0.50, ECR $0.20, S3 $0.12). The ALB is the largest fixed cost; it is kept because it is what
production uses (TLS, health checks, deregistration on deploy).

## Option B — reliable production

Two tasks across two AZs (autoscaling to 4), RDS db.t4g.small **Multi-AZ** with 14-day backups and PITR, tasks in
private subnets with **one NAT gateway per AZ**, AWS WAF on the ALB, customer-managed KMS key, longer log retention.

| Item | London (eu-west-2) | Ireland (eu-west-1) |
| --- | ---: | ---: |
| Fargate: 2 tasks (one per AZ), 1 vCPU / 2 GB each, x86, 24×7 | $82.90 | $72.08 |
| Application Load Balancer: 730 h | $19.32 | $18.40 |
| ALB capacity: 2 LCU average (assumption) | $12.26 | $11.68 |
| RDS PostgreSQL db.t4g.small Multi-AZ | $52.56 | $50.37 |
| RDS gp3 storage 50 GB, Multi-AZ | $13.30 | $12.70 |
| RDS backup storage beyond the free allocation: 20 GB (14-day retention) | $2.00 | $1.90 |
| **NAT gateways: 2 (one per AZ)** | **$73.00** | **$70.08** |
| NAT data processed: 20 GB | $1.00 | $0.96 |
| Public IPv4: 2 (ALB) + 2 (NAT gateways) | $14.60 | $14.60 |
| AWS WAF: 1 web ACL + 3 rules + 5 M requests | $11.00 | $11.00 |
| CloudWatch Logs: 10 GB ingested + 10 GB stored | $6.30 | $6.00 |
| CloudWatch alarms: 15 | $1.50 | $1.50 |
| Secrets Manager: 5 secrets (the 4 above + RDS-managed master credentials) | $2.00 | $2.00 |
| KMS: 1 customer managed key | $1.00 | $1.00 |
| ECR: 5 GB of images | $0.50 | $0.50 |
| Route 53: 1 hosted zone + ~2 M queries | $1.30 | $1.30 |
| Data transfer out to the internet: 200 GB (first 100 GB/month free, account-wide) | $9.00 | $9.00 |
| S3: 50 GB of exported backups | $1.20 | $1.15 |
| **Total per month** | **$304.74** | **$286.22** |

**Recurring fixed costs to notice:** the two NAT gateways ($73) cost almost as much as the two application tasks
($83) and are billed whether or not traffic flows; the ALB (~$19 plus capacity) and every public IPv4 address
($3.65 each) bill around the clock. Alternatives priced: interface endpoints for `ecr.api`, `ecr.dkr`, `logs` and
`secretsmanager` in two AZs $64.24/month (+$0.01/GB) instead of NAT — only once the production MongoDB no longer needs
to be reached; one NAT gateway instead of two saves $36.50 + $3.65 but loses AZ independence for outbound traffic.
Scaling up: db.t4g.medium Multi-AZ $105.85 instead of $52.56; splitting the API into its own service behind an
internal ALB about +$25.45 plus its tasks; each additional production task +$41.45.

## Assumptions and uncertainty

- LCU usage (1 staging, 2 production), log volume, requests, data transfer and backup growth are assumptions for a
  small shop; replace them with measured values after a staging month (Cost Explorer, CloudWatch metrics).
- T4g database instances run in "unlimited" CPU mode by default: sustained load above the baseline adds $0.075 per
  vCPU-hour of surplus credits. Not included.
- Prices change; re-run the extraction before any decision. The numbers above were computed by script from the
  files named at the top, not copied from a calculator.
- Not included: AWS Support, CloudFront (only if the version-skew mitigation is adopted), ElastiCache (only if a
  shared Next.js cache is chosen), cross-region snapshot copies for disaster recovery (storage in the second region
  at its snapshot price plus transfer).
