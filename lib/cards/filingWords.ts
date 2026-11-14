/**
 * SESSION 27 (Akshay, Nov 14, 2026): A FILING IN PLAIN WORDS — one mapping from 8-K item and form to plain words,
 * shared by every place a card names a filing it has not read (headerFilings.test). It names the filing; it never says
 * what the filing does to debt. An unread filing is "read at the next refresh".
 */
export const READ_WHEN = "read at the next refresh";

/** 8-K items, in plain words (Form 8-K's own item titles, shortened). */
export const ITEM_WORDS: Record<string, string> = {
  "1.01": "material agreement", "1.02": "agreement ended", "1.03": "bankruptcy", "1.04": "mine safety",
  "2.01": "acquisition or sale completed", "2.02": "earnings results", "2.03": "new debt or obligation", "2.04": "debt accelerated",
  "2.05": "restructuring costs", "2.06": "impairment", "3.01": "listing notice", "3.02": "unregistered share sale",
  "3.03": "shareholder rights changed", "4.01": "auditor change", "4.02": "restatement", "5.01": "control changed",
  "5.02": "officer change", "5.03": "charter or bylaw change", "5.05": "ethics code change", "5.07": "shareholder vote",
  "5.08": "director nominations", "7.01": "public disclosure", "8.01": "other event", "9.01": "exhibits",
};

/** Other forms, in plain words. */
export const FORM_WORDS: Record<string, string> = {
  "10-Q": "quarterly report", "10-K": "annual report", "4": "insider trades", "3": "insider holdings", "144": "planned insider sales",
  "SC 13G": "ownership", "SC 13G/A": "ownership", "S-8": "employee share plans", "DEF 14A": "proxy statement", "S-3": "registration", "S-3ASR": "registration",
};

/** EDGAR names some forms by number alone ("4", "144"): a reader sees "Form 4". "10-Q" stays "10-Q". */
const formLabel = (form: string) => (/^\d+$/.test(form) ? `Form ${form}` : form);

/** "8-K (public disclosure)", "8-K (earnings results, public disclosure)", "10-Q (quarterly report)". */
export function plainFilingName(f: { form: string; items?: string | null }): string {
  if (f.form === "8-K") {
    const items = String(f.items ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const shown = items.filter((i) => i !== "9.01");
    const words = (shown.length ? shown : items).map((i) => ITEM_WORDS[i] ?? `Item ${i}`);
    return words.length ? `8-K (${words.join(", ")})` : "8-K";
  }
  return `${formLabel(f.form)} (${FORM_WORDS[f.form] ?? "other filing"})`;
}
