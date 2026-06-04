# OSS Components and License Policy

This project should only depend on components that are safe for commercial use under permissive licenses.

## Allowed license families

- MIT
- Apache-2.0
- BSD-2-Clause
- BSD-3-Clause
- PostgreSQL License
- ISC

## Not allowed by default

- SSPL
- AGPL
- GPL for core runtime dependencies
- BSL
- RSAL
- source-available licenses that restrict commercial use or hosted offerings

## Selected components

| Component | Purpose | License | Why selected |
| --- | --- | --- | --- |
| Next.js | Admin console frontend | MIT | Mature React app framework |
| React | UI runtime | MIT | Standard frontend foundation |
| Fastify | Control API and gateway services | MIT | Fast and simple TypeScript-friendly backend framework |
| TypeScript | Shared language/tooling | Apache-2.0 | Safe and standard |
| tsx | Local dev TypeScript runner | MIT | Lightweight developer workflow |
| Zod | Env and contract validation | MIT | Small and reliable schema validation |
| pg | PostgreSQL client | MIT | Direct SQL without ORM lock-in |
| PostgreSQL | Primary relational database | PostgreSQL License | Commercially safe open-source database |
| Valkey | Cache / counters / rate-limit backend | BSD-3-Clause | Open fork that avoids Redis licensing issues |

## Explicitly avoided for now

| Component | Reason |
| --- | --- |
| Redis OSS | Redis licensing moved away from permissive open source; use Valkey instead |
| MinIO | License posture is not our default preference for core platform dependencies |
| Elastic default distribution | Source-available / licensing concerns |
| Any AGPL-hosted core dependency | Avoid infection risk in the main product path |

## Rule for adding new dependencies

Before adding a new major dependency:

1. Check the license
2. Confirm hosted commercial use is allowed
3. Add it to this file
4. Prefer composition through adapters instead of copying source code from other projects
