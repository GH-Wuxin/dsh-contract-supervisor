# DeepSeek Harness Contract-First Supervisor

[简体中文](README.zh-CN.md) | English

**A contract-first supervisor for DeepSeek Harness.**

Pro can propose. Flash can execute. Neither gets to decide its own authority.

Filesystem scope comes from frozen Contract / Slice state, while model and
runtime policy are fixed by trusted host configuration. A deterministic
Supervisor enforces both.

**Status: Early Alpha — MVP in progress.**

## Why

Many agent systems let the model propose what to do while also giving it broad
or indirectly model-controlled execution authority. This project separates
those two concerns.

```text
Pro proposes
    ↓ advisory only
Supervisor owns authority
    ↓ frozen policy
Flash executes
    ↓ Slice-scoped tools
```

A model can suggest an action, but it cannot grant itself tools, expand its
filesystem scope, change worker configuration, or create a new authority path.

## How it works

A run starts from a Human / RunSpec and follows one fixed path:

```text
Human / RunSpec
  → host CLI (contract-supervisor-run)
  → Pro commander: one advisory instruction, zero tools
  → deterministic Supervisor: admission check against frozen Contract / Slice
  → Flash worker: exactly one implementation Attempt
  → Slice-scoped tools: slice_read / slice_search / slice_write / slice_edit
```

- **Pro** is a commander with one advisory turn and zero tools. Its output is
  a suggestion, never a command.
- **Supervisor** checks every step against the frozen Contract / Slice
  identities and records each outcome in deterministic, append-only state.
- **Flash** is a disposable worker with exactly one Attempt, Slice-scoped
  tools, and a hard-frozen model selection.

Integration and orchestration tests run against the genuine DSH runtime with
scripted LLM adapters. The first live DeepSeek API dogfood run is still
pending.

## What works today

All of the following is covered by the test suite:

- Frozen Contract / Slice identities — canonical hashing, deep immutability.
- Deterministic admission — scope expansion and unknown verifier references
  are rejected.
- Deterministic Supervisor state machine — illegal transitions and attempt
  ID reuse are rejected; retries always get a fresh Attempt.
- Append-only durable JSONL ledger with tamper detection.
- Disposable worker lifecycle — one run per worker, one dispose, no faked
  runs.
- Audited Slice-scoped filesystem access — four audited tools, fail-closed.
- Genuine DSH plugin integration — real Cordis patch, profile load and boot,
  host-side `contract-supervisor-run` CLI.
- Pro → Supervisor → Flash orchestration with scripted LLM adapters.
- 252 deterministic tests pass on the current public revision, plus Linux
  GitHub Actions CI (typecheck, tests, smoke).

## Authority model

Four rules, no exceptions:

- Models do not define authority.
- Pro has no tools; its output is advisory only.
- Flash receives only Slice-derived tools and filesystem scope.
- Invalid or uncertain state fails closed — no partial grants.

## Development

Requirements: Node.js 24+, npm 11+.

```sh
npm ci
npm run typecheck
npm test
npm run smoke:dsh
npm run build
```

- `npm test` — deterministic suite (252 tests).
- `npm run smoke:dsh` — loads this package through the genuine DSH profile
  machinery with a temporary `$DSH_HOME` outside the repository; no API keys,
  no paid calls.

## Current limitations

- Early Alpha — MVP is not yet declared complete.
- The first live paid Pro → Flash dogfood run is still pending.
- Installation is developer/internal only: the package loads as a DSH
  profile bundle from a local checkout. A clean public install procedure is
  not established yet.
- Verifier / reviewer / seal / self-hosting work is unfinished.

## Roadmap

1. Live Pro → Flash dogfood run.
2. Finish the MVP.
3. First self-hosted maintenance Slice.
4. Declare MVP complete.
5. Post-MVP verifier / reviewer / seal expansion.

## License

GNU General Public License version 3 only (SPDX: `GPL-3.0-only`). See the
`LICENSE` file for the full text.