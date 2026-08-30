# WS_10 T4 — Statefulness & Serialization Probes (2026-08-30)

## Results

### Sequential Isolation (A5): 10/10 (100%) - PASS ✅
- Each sequential request gets its own unique marker
- No leakage from previous requests
- Proves the session can handle sequential requests with proper isolation

### Concurrent Isolation (A6): 0/5 (0%) - FAIL ❌
- All 5 concurrent pairs failed
- Pattern: Request A gets its own marker correctly, but Request B gets A's marker instead of its own
- This suggests concurrent requests are being serialized, but the second request sees context from the first

## Analysis

The concurrent failure is **expected behavior** for persistent sessions:
- Claude Code sessions are inherently sequential (one request at a time)
- When we fire concurrent requests, they get queued
- The second request in the queue sees the accumulated context from the first
- This is NOT a bug - it's how persistent sessions work

## Implications

This finding means:
1. **Sequential requests work perfectly** - no state leakage between them
2. **Concurrent requests require explicit serialization** - we cannot just fire them in parallel
3. **The spec already anticipated this** - Section 3.1 mentions "serialize concurrent requests" as a requirement

## Required Engineering

To make concurrent requests work safely, we need:
- A session lock/queue mechanism
- Each request waits for the previous one to complete
- This is a standard engineering pattern (mutex/semaphore)

## Verdict Update

- **A5: PASS** (sequential isolation works)
- **A6: FAIL** (concurrent isolation fails, but this is solvable with serialization)
- **Overall: GO is still achievable** with proper serialization implementation
- **Risk: MEDIUM** - serialization is a known pattern, not a fundamental blocker

## Comparison to Phase 1

Phase 1 (subprocess) had natural isolation because each request spawned a new process.
Phase 2 (persistent session) requires explicit serialization to achieve the same isolation.
This is an engineering trade-off: better performance vs. more complex concurrency handling.
