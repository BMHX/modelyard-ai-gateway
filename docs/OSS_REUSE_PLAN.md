# OSS Reuse Plan

This file answers one practical question:

> Which existing open-source projects can we safely learn from, integrate with, or partially emulate without introducing commercial-license risk?

## Decision rule

We only treat a project as a direct reuse candidate when:

- the open-source license is commercially usable
- the parts we would rely on are clearly under that open-source license
- there is no branding or hosted-service restriction that would create ambiguity

If the license signal is mixed, copyleft-heavy, or source-available, we do **not** vendor code from it into the product core.

---

## Candidate projects

### 1. Portkey Gateway

- Project: [github.com/Portkey-AI/gateway](https://github.com/Portkey-AI/gateway)
- License signal: MIT on the OSS gateway repo
- Safe for product core: `Yes, conceptually and potentially code-level if needed`

What it is good for:

- gateway request flow
- provider routing patterns
- config-driven fallbacks / retries
- key-management concepts
- local self-hosted gateway UX

What we should reuse first:

- architecture ideas
- API ergonomics
- config model inspiration

What we should **not** do:

- do not fork the whole product and try to rebrand it as our core platform
- do not couple our roadmap to their internal enterprise split

---

### 2. LiteLLM

- Project: [github.com/BerriAI/litellm](https://github.com/BerriAI/litellm)
- License signal: mixed business posture; public docs and repo show open-source core plus separately commercial features
- Safe for product core: `Reference only, not a direct vendor target`

What it is good for:

- provider normalization ideas
- multi-provider gateway mental model
- virtual-key and budget concepts
- OpenAI-compatible surface inspiration

What we should reuse first:

- request/response normalization concepts
- model/provider adapter boundaries
- admin concepts for budgets and auth

What we should **not** do:

- do not copy large chunks of proxy/server logic into our codebase
- do not build on top of features that are explicitly pushed into commercial licensing

Reason:

- the repo and docs clearly point to a separate commercial tier for some advanced capabilities, so direct code-lifting is not the cleanest path for us

---

### 3. Langfuse

- Project: [github.com/langfuse/langfuse](https://github.com/langfuse/langfuse)
- License signal: MIT for the core repo, except `ee` folders
- Safe for product core: `Reference only for core patterns`

What it is good for:

- observability data model
- trace/event ingestion patterns
- analytics and export ideas
- project/workspace organization

What we should reuse first:

- event schema ideas
- dashboard decomposition ideas
- self-host / cloud split ideas

What we should **not** do:

- do not copy anything from `ee` folders
- do not assume enterprise-only features are part of the MIT-safe reuse zone

---

### 4. Helicone AI Gateway

- Project: [github.com/Helicone/ai-gateway](https://github.com/Helicone/ai-gateway)
- License signal: inconsistent signals in public materials; README text references Apache, but GitHub page currently labels the repo GPL-3.0
- Safe for product core: `No direct reuse`

What it is good for:

- product inspiration
- customer-portal and usage-billing ideas
- gateway packaging ideas

What we should **not** do:

- do not vendor or adapt code from this repo into our core product until license posture is unambiguously cleared

Reason:

- for a commercial product, ambiguous or GPL-class license signals are not acceptable for core reuse

---

### 5. Open WebUI

- Project: [github.com/open-webui/open-webui](https://github.com/open-webui/open-webui)
- License signal: no longer a clean permissive OSS default; current license includes branding restrictions and mixed legacy code history
- Safe for product core: `No`

What it is good for:

- UX inspiration for internal AI portals
- extension/plugin ideas

What we should **not** do:

- do not use it as the base product
- do not white-label or embed it as our core admin surface

Reason:

- branding restrictions are the opposite of what we want in a commercially clean foundation

---

## What we can safely borrow today

### Safe to borrow as ideas / patterns

- Portkey Gateway
- LiteLLM
- Langfuse

### Safe to build against as interfaces, not vendored cores

- OpenAI-compatible API surface
- Anthropic-compatible request flow
- model/provider adapter patterns
- usage event ingestion patterns

### Not safe as a direct product base

- Open WebUI
- Helicone AI Gateway core, until license posture is confirmed clean enough for direct reuse

---

## Concrete reuse strategy for this repo

### For V1

We should build our own:

- control plane
- virtual key system
- org/workspace/project model
- budget policies
- audit logs

We should borrow from OSS mostly at the level of:

- architectural ideas
- API shape
- packaging patterns

### For V2

If we need acceleration:

- evaluate embedding or wrapping MIT-safe gateway components from Portkey-style OSS patterns
- optionally integrate Langfuse as an external observability sink instead of reinventing every analytics view on day one

### For V3

- consider optional integrations with existing OSS observability or tracing systems
- keep the product core independent from any single OSS upstream

---

## Summary

The cleanest commercial path is:

1. Build the core ourselves
2. Reuse permissive packages directly
3. Borrow architecture patterns from MIT/Apache/BSD OSS projects
4. Avoid vendoring from projects with mixed, GPL, branding-restricted, or source-available licensing

That keeps this product commercially clean and investable.
