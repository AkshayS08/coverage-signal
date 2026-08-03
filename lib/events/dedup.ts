import type { TriggerResult } from "../agent";

/**
 * Groups triggers that describe the same real-world event into one
 * cluster, so one event = one card (fixes the old triple-counting where
 * e.g. "asset sale" and "acquisition announced" both fired off the same
 * 8-K describing a single divestiture).
 *
 * Clustering key: shared 8-K citation URLs only. 8-Ks report discrete
 * triggering events by SEC design, so two triggers citing the same 8-K are
 * very likely the same underlying event. 10-Ks/10-Qs are periodic reports
 * covering many unrelated standing facts (a debt footnote, a buyback
 * program, a capex note can all live in the same 10-K) — clustering on
 * those would wrongly merge genuinely distinct events, so they're ignored
 * as a clustering key (a trigger cited only from a 10-K/10-Q always starts
 * its own cluster).
 */
export function clusterIntoEvents(triggers: TriggerResult[]): TriggerResult[][] {
  const parent = new Map<number, number>();

  function find(i: number): number {
    let root = i;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = i;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  function union(a: number, b: number): void {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  }

  triggers.forEach((_, i) => parent.set(i, i));

  const byEightK = new Map<string, number[]>();
  triggers.forEach((trigger, i) => {
    for (const c of trigger.citations) {
      if (c.form !== "8-K") continue;
      const bucket = byEightK.get(c.url);
      if (bucket) bucket.push(i);
      else byEightK.set(c.url, [i]);
    }
  });

  for (const indices of byEightK.values()) {
    for (let k = 1; k < indices.length; k++) union(indices[0], indices[k]);
  }

  const clusters = new Map<number, number[]>();
  triggers.forEach((_, i) => {
    const root = find(i);
    const bucket = clusters.get(root);
    if (bucket) bucket.push(i);
    else clusters.set(root, [i]);
  });

  return [...clusters.values()].map((indices) => indices.map((i) => triggers[i]));
}
