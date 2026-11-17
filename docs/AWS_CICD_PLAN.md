# AWS CI/CD plan (Phase 7B — design for review; no AWS job is enabled)

**Status.** Implemented and safe today: `.github/workflows/container.yml` (build both images, scan, SBOM, Compose
stack, container integration test — no registry, no AWS, no secret). Everything below the line "Not enabled" is
design only: no AWS role, OIDC provider, ECR repository or deployment job exists, and none may be created without
approval. Existing workflows `ci.yml` and `browser.yml` are unchanged (`docs/CI.md`).

## Pipeline

```
 pull request ─▶ ci.yml (11 jobs) ─┐
               ─▶ browser.yml (7)  ├─▶ all green ─▶ merge to the release branch
               ─▶ container.yml ───┘
 release branch push
   1 verify      ci.yml + browser.yml + container.yml on the exact commit (required checks)
   2 build       docker build both images once; tag = full commit SHA; record image digests
   3 evidence    Trivy scan (gate: secrets, fixable CRITICAL/HIGH) + npm audit; CycloneDX SBOM; build provenance
   4 publish     ── Not enabled ── OIDC → staging role → push to ECR (immutable tags), attach SBOM + provenance
   5 staging     run the migrate task with the image digest → update the service to the digest → wait stable
   6 verify      ALB health, smoke checks (container-integration subset against the staging URL), browser suite
                 subset against staging, CloudWatch alarms quiet for 15 minutes
   7 approve     GitHub Environment "production": required reviewer (the owner), wait timer
   8 production  OIDC → production role → migrate task → service update to the SAME digests → health + smoke
   9 watch/roll  circuit breaker + alarms; on failure ECS rolls back to the previous task definition revision
```

## Rules

1. **Build once, deploy the digest.** Images are built in step 2 only. Staging and production task definitions
   reference `…/ecommerce-api@sha256:<digest>` and `…/ecommerce-web@sha256:<digest>`, never a tag; no `latest` tag
   exists in ECR (tag immutability on). Production deploys exactly the digests that passed staging.
2. **Tags:** the full commit SHA (immutable) plus, for humans, the release number. The SHA links an image to its
   CI runs, SBOM and scan report.
3. **Evidence kept:** CI logs and artifacts (90 days in GitHub; SBOM, scan report and image digests also stored in an
   S3 evidence bucket with versioning), ECR scan results, ECS deployment history, CloudTrail for every AWS API call.
4. **Gates that block:** any failed test or browser job; a secret in an image; a CRITICAL or HIGH vulnerability with
   a fixed version available; `npm audit` above the agreed level; a failed migration; staging smoke or alarm failure.
   Gates are not bypassed by re-running until green: a failure is classified first (as in Phase 7A).
5. **Provenance:** `docker buildx build --provenance=mode=max --sbom=true` (or `actions/attest-build-provenance`
   pinned by SHA) so each digest carries how and from which commit it was built; base images pinned by digest.

## AWS access (design)

- **GitHub OIDC**, no long-lived keys: an IAM OIDC identity provider for `token.actions.githubusercontent.com`
  with audience `sts.amazonaws.com`.
- **Two roles**, each assumable only by this repository and only from its GitHub Environment:

| Role | Trust condition (`sub`) | Permissions (least privilege) |
| --- | --- | --- |
| `gha-ecommerce-staging-deploy` | `repo:Manoj132508/Ecommerce-project:environment:staging` | ECR push to the two repositories; `ecs:RunTask` (migrate task definition only), `ecs:RegisterTaskDefinition`, `ecs:UpdateService`/`DescribeServices` on the staging cluster; `iam:PassRole` for the staging execution and task roles only; read the staging log groups |
| `gha-ecommerce-production-deploy` | `repo:Manoj132508/Ecommerce-project:environment:production` | the same on production resources, **no ECR push** (production only pulls digests already in ECR); no IAM changes; no RDS, Secrets Manager or VPC permissions |

- Separate accounts for staging and production are preferable (AWS Organizations); if one account is used, every
  resource name and ARN in the policies is environment-scoped.
- Infrastructure changes (Terraform/CDK) run in a separate workflow with a plan for review and a manual apply, with
  its own role — never from the application deploy role.
- GitHub settings: environment `production` with required reviewer and branch restriction; `contents: read` by
  default; `id-token: write` only on the deploy jobs; third-party actions pinned to commit SHAs.

## Rollback

| Failure | Detection | Action |
| --- | --- | --- |
| New tasks fail health checks | ECS deployment circuit breaker | Automatic rollback to the previous task definition revision |
| Errors after a "successful" deploy | 5xx / target alarms during the watch window | `aws ecs update-service --task-definition <previous revision>` (same digests as before) |
| Migration failed | migrate task exit code ≠ 0 | Service not updated; the migrator applies each file in a transaction; fix forward |
| Migration applied, code faulty | as above | Roll back the service only — migrations are backward-compatible by rule (expand, then contract in a later release) |
| Data damage | alarms, reports | `docs/CUTOVER_RUNBOOK.md` §5 (write freeze, PITR to a new instance) |

## Not enabled now (and why)

No deployment job, ECR push or AWS credential exists: Phase 7B is local and design only. Turning on steps 4–9
requires: the AWS account and IaC (Phase 7C), the code changes listed in `AWS_ARCHITECTURE.md` §12, the two OIDC
roles reviewed, and the owner's approval. The container workflow will fail its scan gate until mongoose is updated
(two HIGH, fixed in 9.11.4) — intended.
