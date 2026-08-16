export * from "./buckets";
export * from "./eligibility";
export * from "./dedup";
export * from "./buildEvents";
export * from "./eventBriefing";
export * from "./labels";
export * from "./factBase";
export * from "./portfolioTable";
// sonnetEventBriefing.ts is deliberately NOT re-exported here — it pulls
// in the Anthropic SDK and must stay out of any client-importable barrel.
// The portfolio table (Session 15 Part B) is now fully deterministic —
// portfolioTable.ts has no SDK dependency, so it's safe in this barrel and
// is computed client-side from `results`, same as buildEvents itself.
