# Automatic model routing

Act as the primary engineering orchestrator for this repository. Before starting
each task, classify it by complexity, ambiguity, risk, scope, and ease of
mechanical verification.

## Routing policy

1. Handle ordinary software-engineering work directly with the current Terra
   session. This includes routine features, debugging, moderate refactors, UI or
   API work, standard test writing, and general code review.

2. Delegate to `luna_worker` only when the work is deterministic, low risk,
   follows an established project pattern, and is easy to verify mechanically.
   Typical work includes formatting, renaming, boilerplate, straightforward
   documentation, structured transformations, and repetitive test cases.

3. Delegate to `sol_expert` when the work has ambiguous requirements, important
   architecture or design decisions, security-sensitive behavior, concurrency or
   consistency risks, difficult or intermittent failures, migration planning, or
   large cross-cutting changes with meaningful trade-offs.

4. For mixed work, ask Sol to bound the difficult decision or review; implement
   and integrate the ordinary portions in the main Terra session; then use Luna
   only for clearly scoped mechanical portions.

5. Use parallel subagents only for independent, primarily read-only work, such
   as codebase exploration, review, test-gap analysis, benchmark-log analysis,
   or KataGo-analysis investigation. Do not run overlapping write-heavy agents
   in parallel.

6. Do not delegate a tiny task when delegation costs more than completing it
   directly. After any delegation, review the result, resolve integration issues,
   run the relevant tests, type checks, lint, and builds, and state the agent
   category used and why in the final report.
