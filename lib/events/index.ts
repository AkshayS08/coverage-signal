export * from "./buckets";
export * from "./eligibility";
export * from "./dedup";
export * from "./buildEvents";
export * from "./eventBriefing";
export * from "./labels";
export * from "./factBase";
export * from "./portfolioTable";
// position.ts (Session 18): pure code, no model/SDK dependency — same
// client-safety reasoning as portfolioTable.ts above.
export * from "./position";
// extractionReport.ts (Session 18): pure assembly over already-exported
// checks — type-only imports of the agent/fetch layers, no SDK, same
// client-safety reasoning as position.ts above.
export * from "./extractionReport";
// sonnetEventBriefing.ts is deliberately NOT re-exported here — it pulls
// in the Anthropic SDK and must stay out of any client-importable barrel.
// The portfolio table (Session 15 Part B) is now fully deterministic —
// portfolioTable.ts has no SDK dependency, so it's safe in this barrel and
// is computed client-side from `results`, same as buildEvents itself.
