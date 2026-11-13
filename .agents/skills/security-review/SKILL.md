---
name: security-review
description: Perform defensive source review of this application's Express and React trust boundaries when asked to audit API security, refresh authorization, dependency risks, or sensitive-data handling.
license: LICENSE
---

# Defensive security review

Project adaptation of [Sentry security-review](https://github.com/getsentry/skills/tree/e94f22214528d69899d09c627b3315ddc3544816/skills/security-review). Changes restrict the workflow to source-based assessment, omit generic payload and infrastructure examples, and use the project's trust boundaries.

Use [OWASP ASVS 5.0](https://github.com/OWASP/ASVS/releases/tag/v5.0.0_release) and [official Express security guidance](https://expressjs.com/advanced/best-practice-security/) as review standards. Treat framework protections and operational assumptions as conditions to verify. A request handler, a configuration setting, and a deployed reverse proxy supply different evidence.

1. Establish the requested review surface. Trace relevant callers, validation and sinks through source while keeping reported findings inside scope. Distinguish public economic reads, operator refresh, deployment configuration and configured external providers. Identify who controls the value at each boundary.
2. Inspect [Express routes and middleware](../../../backend/src/server.js) for exact scalar input validation, authorization placement, timing-safe token comparison, body and rate limits, CORS, proxy trust and sanitized errors. Review authenticated routes for authorization and workflow gaps too. CORS is a browser policy and the bearer check protects operator refresh.
3. Check [SQL construction](../../../backend/src/db/repository.js) for bound values and allowlisted identifiers. Inspect [WDI URL construction](../../../backend/src/wb/client.js) and [geo lookup](../../../backend/src/services/geo.js) for destination provenance, encoded parts, redirects, privacy and validated responses. Apply [WDI/libSQL data integrity](../wdi-libsql-data-integrity/SKILL.md) for publication and fallback. Review explicit data flows to logs and JSON outputs without reading secret-bearing environment files or credential values.
4. Check locked versions against vendor advisories and document prerequisites for relevance. Separate source behavior, hypothetical conditions and deployment facts. Evaluate security headers and TLS from authorized configuration evidence when available.
5. Report each high-confidence issue with file/line, affected trust boundary, reachability evidence, impact, and targeted remediation. Mark uncertain prerequisites as unverified. Validate remediation through benign, isolated contract tests that assert rejection, authorization or sanitization. Do not develop exploits, probe deployed services, reproduce vulnerabilities offensively, run dependency installers, or inspect or disclose credentials. This skill grants no tools, delegation or network permissions.
