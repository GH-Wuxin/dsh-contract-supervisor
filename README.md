# DeepSeek Harness Contract-First Supervisor

A DSH (DeepSeek Harness) plugin package that supervises a disposable-agent
pipeline with frozen contract identities and deterministic, append-only state.

**Status: Early Alpha — MVP completion in progress.**
This is not production ready.

## 1. What this is

`dsh-contract-supervisor` is an experimental DSH plugin (package name
`dsh-contract-supervisor`, `"private": true` — intended for source
publication, not npm publishing). It implements a small, auditable supervisor
that runs a real DSH agent pipeline:

- a **Pro commander** produces an advisory instruction for one slice,
- a **Flash worker** performs exactly one implementation attempt,
- the worker can only touch a **Slice-scoped filesystem** through four
  audited tools,
- every step is checked against a **frozen Contract/Slice identity** and
  recorded in **deterministic, append-only state**.

The point of the project is the boundary: authority comes from frozen
contract artifacts and trusted state transitions, never from what a model
writes.

## 2. Status

- Early Alpha — MVP completion is in progress, not yet declared complete.
- The first paid real Pro → Flash dogfood run is still pending.
- 252 deterministic tests pass at the sealed C5.2 checkpoint.
- Later verifier/reviewer/seal/self-hosting work may still be unfinished.
- Do not treat this as production software.

## 3. Why Contract-First

- Agents are disposable; verified state is durable.
- A worker reporting `PASS` is not a checkpoint `PASS`.
- Pro advisory text has authority delta zero.
- Authority comes from the frozen Contract/Slice and the Supervisor state
  machine, not from model output.
- A fresh worker is spawned per Attempt.
- Scope enforcement fails closed.

## 4. Architecture

```
Human / RunSpec
  → host CLI (contract-supervisor-run)
  → fresh Pro commander (one turn, zero tools, advisory only)
  → deterministic Supervisor (frozen identities + append-only ledger)
  → fresh Flash worker (one Attempt per invocation)
  → Slice-scoped tools (slice_read / slice_search / slice_write / slice_edit)
```

The commander's output is advisory text; the Supervisor derives authority
from the frozen Contract/Slice identities and the audited tool surface. The
worker is a real `@deepseek-ai` DSH agent configured in a single
one-shot attempt with a hard-frozen `deepseek-ai/Flash` model and an
allowlist limited to the audited filesystem tools.

## 5. Current guarantees (at sealed checkpoint C5.2)

Everything below is covered by deterministic tests in `tests/`:

- **Frozen Contract / Slice identities** with canonical hashing and deep
  immutability (`CONTRACT-*`, `SLICE-*`, `HASH-*`, `IMMUTABLE-*`).
- **Deterministic admission** — scope expansion and unknown verifier refs are
  rejected (`AUTH-*`).
- **Deterministic Supervisor state machine** — illegal transitions, attempt
  ID reuse, retry with fresh attempts, dispose barriers (`STATE-*`).
- **Append-only durable JSONL ledger** with tamper detection and torn-tail
  recovery (`LEDGER-*`).
- **Worker Lifecycle** — one run per worker, dispose exactly once, fresh
  worker/session per Attempt, spawn failures never fake a run
  (`WORKER-*`).
- **Audited Slice-scoped filesystem access** — exactly four tools, authority
  frozen at construction, violations invalidate the attempt (`FS-*`).
- **Real DSH plugin integration** — genuine Cordis patch, profile load and
  boot against the real `@deepseek-ai/dsh-app-boot` machinery, no worker
  spawned on load (`INT-*` plus the `smoke:dsh` script).
- **Host-side `contract-supervisor-run` CLI** driving the real DSH
  orchestration in one boot (driver tier-1/2/3 tests).
- **Real Pro commander orchestration** — zero-tool commander boundary, one
  Flash Attempt per invocation, frozen `deepseek-ai/Pro` commander and
  `deepseek-ai/Flash` worker (RunSpec cannot override the models).
- **252 deterministic tests** at the sealed checkpoint.

`lib/` is generated from `src/` by `npm run build` and is committed as part
of the sealed source distribution.

## 6. Current limitations

- MVP is not yet declared complete.
- The first paid real Pro → Flash dogfood run is still pending.
- Not production ready; no security or reliability guarantees beyond what the
  tests demonstrate.
- Later verifier/reviewer/seal/self-hosting work may still be unfinished.
- Installation is currently developer/internal: the package is loaded as a
  DSH profile bundle plugin from a local checkout. A clean public
  installation procedure is not yet established.
- The `contract-supervisor-run` CLI requires a DSH profile/launcher context
  and is a developer seam, not a model-facing tool.

## 7. Development / verification

Requirements: Node.js 24+, npm 11+. All dependencies are installed from the
public npm registry (`npm ci` is reproducible via `package-lock.json`).

```sh
npm ci
npm run typecheck
npm test
npm run smoke:dsh
npm run build
```

- `npm test` — the deterministic suite (252 tests at C5.2).
- `npm run smoke:dsh` — real DSH profile/bundle load smoke. It creates a
  temporary `$DSH_HOME` outside the repository, loads this package through the
  genuine DSH profile machinery, and verifies the plugin activates and
  provides its service seam. It requires no API keys and makes no paid API
  calls.

## 8. Project status / roadmap

- Early Alpha — MVP completion in progress (current).
- Declare the MVP complete at a future checkpoint.
- First paid real Pro → Flash dogfood run.
- Verifier / reviewer / seal machinery, then self-hosting.

The roadmap is aspirational; nothing beyond the current checkpoint is
promised.

## 9. License status

No license has been chosen for this repository yet, and none is implied.
Until a license is selected, all rights are reserved.

Neutral options for the owner to consider:

- **MIT** — permissive, simple.
- **Apache-2.0** — permissive with an explicit patent grant.
- **GPL-3.0** — strong copyleft.

This is a human decision; the repository owner must make it before broad
public reuse is encouraged.