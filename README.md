# Quotagate

Local OpenAI-compatible proxy that turns your Claude Pro/Max, Gemini Advanced, or ChatGPT Plus subscription into a programmatic API endpoint.

## Install

```bash
npm install
```

## Green-gate commands

```bash
npm run typecheck    # tsc --noEmit — zero errors required
npm run build        # tsup — dist/index.js must be produced
npm run lint         # eslint . — zero errors required
npm run format       # prettier --write . — produces no diff when clean
npm test             # vitest run — all tests must pass
```
