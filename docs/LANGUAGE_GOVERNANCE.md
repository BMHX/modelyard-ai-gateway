# Language Governance

This repository uses a strict language split so product, UI, and docs stop drifting into mixed-language output.

## Core Rules

- Code identifiers stay in English: types, variables, functions, routes, API fields, database fields, and log keys.
- `apps/web-admin` UI copy uses English message keys as the single source of truth.
- Chinese UI copy must come from the matching `zh` message files. Do not write Chinese or English UI copy directly in components, server pages, actions, or helpers.
- The only supported web-admin locales are `en` and `zh`. `zh-CN` is a legacy redirect target only and must not be used as an active locale, message directory, or code branch.
- Control API and Gateway return stable English error payloads with machine-readable `error.code`. Final user-facing localization happens in `web-admin`.

## English-Source UI Policy

- Add or change UI copy in `apps/web-admin/app/messages/en/*.json` first.
- Mirror the same key structure in `apps/web-admin/app/messages/zh/*.json`.
- Do not create zh-only keys.
- Prefer message keys over inline fallback text. If a component needs localized copy, resolve it through the message catalog.
- `translateInlineText` is a temporary compatibility escape hatch. It is allowed only in the existing adapter files tracked by the repo lint guard and should shrink over time.

## Allowed English Product Terms In Chinese UI

These terms may stay in English when they refer to product or protocol vocabulary:

- `BYOK`
- `Claude Code`
- `OpenAI`
- `Anthropic`
- `Gateway`
- `Control Plane`

Everything else should be localized unless there is a protocol or branding reason not to.

## API Error Policy

- Return `error.code` for all user-visible API failures.
- Keep `error.message` in stable English for diagnostics and logs.
- Use `error.resource` and `error.details` when the client needs structured context.
- Do not add localized API messages.

## Documentation Policy

- Product positioning, architecture, API, deployment, and external-facing docs stay English-first.
- Internal execution, remediation, and rollout docs may stay Chinese, but they must use an explicit `_ZH` suffix or another equally obvious Chinese-language marker.
- Do not create same-purpose docs at the same level with mixed language and no marker.

## Enforcement

- `npm run lint` enforces message parity, blocks legacy `zh-CN` message files, and guards against new UI language anti-patterns in `apps/web-admin`.
- Any new exception should be treated as a design debt entry and added only when the repo cannot move forward without it.
