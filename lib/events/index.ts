export * from "./buckets";
export * from "./eligibility";
export * from "./dedup";
export * from "./buildEvents";
export * from "./eventBriefing";
export * from "./labels";
export * from "./factBase";
// sonnetEventBriefing.ts and sonnetPortfolioSummary.ts are deliberately NOT
// re-exported here — both pull in the Anthropic SDK and must stay out of
// any client-importable barrel. The portfolio-table summary (Session 12
// Part B) is now a server-side Sonnet call like card narration, streamed
// to the client via RunStreamEvent rather than computed in the browser.
