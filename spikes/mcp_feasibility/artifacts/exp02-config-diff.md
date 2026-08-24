# WS_10 T2 / exp02 — ~/.claude.json mutation audit (D3 protocol, 2026-08-24)

Backup: claude.json.backup-2026-08-24T135325Z (sha256 prefix 819148069108d22a)

## Registrations lifecycle
- Added by experiment: projects[/Users/.../Quotagate].mcpServers[ws10-hello-server] (-s local),
  top-level mcpServers[ws10-hello-server] (-s user), Quotagate/.mcp.json (-s project).
- JSON validated after EVERY write: pass.
- Removed at close: `claude mcp remove -s local/user`; .mcp.json deleted.
- Post-cleanup: zero ws10 entries anywhere (python deep-scan); `claude mcp list` shows no ws10;
  orphan sweep clean.

## Residual diff vs backup (all CLI-internal churn, none ours)
- Experiment flags / tipsHistory / tipLifetimeShownCounts / numStartups(494->495) /
  cachedGrowthBookFeatures / cachedExperimentData / clientDataCacheSlots / changelogLastFetched:
  normal CLI self-rewrite between backup and now.
- oauthAccount block swapped: expected — the USER re-authenticated mid-task after a spend-limit
  OAuth expiry (hub4realtil -> sfrimpong112 account). Not an experiment side effect.
- projects[*].last* session stats: per-project telemetry updated by ordinary CLI usage.

## Verdict
Only test registrations were added — and fully removed. No unexplained delta. D3 protocol satisfied.
