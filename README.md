# E-commerce Application

[![Modernization review branch CI](https://github.com/Manoj132508/Ecommerce-project/actions/workflows/ci.yml/badge.svg?branch=portfolio-week%2Fecommerce-modernization)](https://github.com/Manoj132508/Ecommerce-project/actions/workflows/ci.yml?query=branch%3Aportfolio-week%2Fecommerce-modernization)

A React/Vite storefront with a Node.js/Express API and MongoDB persistence.
This default branch is the original application; its source includes product,
cart and order flows, authentication and admin functionality.

## Explore the modernization work

The badge above explicitly tracks the separate
[`portfolio-week/ecommerce-modernization` review branch](https://github.com/Manoj132508/Ecommerce-project/tree/portfolio-week/ecommerce-modernization).
That branch contains the Next.js/TypeScript storefront, domain-selected
PostgreSQL repositories, versioned migrations, data-copy/verification tooling,
Dockerfiles and CI checks.

- [Modernization overview and status](https://github.com/Manoj132508/Ecommerce-project/blob/portfolio-week/ecommerce-modernization/README.md)
- [Architecture, Docker workflow and testing evidence](https://github.com/Manoj132508/Ecommerce-project/blob/portfolio-week/ecommerce-modernization/docs/portfolio-evidence.md)
- [PostgreSQL schema and migration procedures](https://github.com/Manoj132508/Ecommerce-project/blob/portfolio-week/ecommerce-modernization/ecommerce-backend/db/README.md)
- [Verified review-branch CI run](https://github.com/Manoj132508/Ecommerce-project/actions/runs/39941498302)

This is a staged, reversible migration under review. The badge and linked test
results do not claim that PostgreSQL or Next.js has replaced the default
application, or that a zero-downtime production cutover has been measured.

## Default-branch layout

| Directory | Implementation |
| --- | --- |
| `ecommerce-project/` | React/Vite frontend, Axios API client and shared React contexts |
| `ecommerce-backend/` | Express API, MongoDB/Mongoose models, JWT authentication and Node tests |

## Run the original application

Follow the component guides for configuration and endpoint details:

- [Backend setup and authentication](ecommerce-backend/README.md)
- [Frontend setup and data flow](ecommerce-project/README.md)

The backend requires MongoDB plus private `MONGODB_URI` and `JWT_SECRET`
configuration. Keep environment values out of source control.

```powershell
# Terminal 1 - API
cd ecommerce-backend
npm.cmd install
# Configure .env from .env.example as described in the backend guide.
npm.cmd run dev

# Terminal 2 - frontend, starting from the repository root
cd ecommerce-project
npm.cmd install
npm.cmd run dev
```

The frontend development proxy expects the API at `http://localhost:3000`.
Open the URL printed by Vite. See the frontend guide to configure a different
API origin.

## Default-branch checks

```powershell
cd ecommerce-backend
npm.cmd test

cd ../ecommerce-project
npm.cmd run lint
npm.cmd run build
```

These commands describe the scripts present in this branch. They are separate
from the Next.js and PostgreSQL CI results on the modernization branch.
