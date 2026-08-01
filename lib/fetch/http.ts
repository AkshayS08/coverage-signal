const SEC_USER_AGENT =
  process.env.SEC_USER_AGENT || "CoverageSignal akshaysahani23@gmail.com";

// SEC asks for no more than ~10 requests/sec; stay comfortably under that.
const MIN_INTERVAL_MS = 120;

let chain: Promise<void> = Promise.resolve();
let lastRequestAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function throttle(): Promise<void> {
  const turn = chain.then(async () => {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
  });
  chain = turn;
  return turn;
}

/** Fetches JSON from a SEC EDGAR endpoint, throttled and with a real User-Agent. */
export async function secFetchJson<T>(url: string): Promise<T> {
  await throttle();
  const res = await fetch(url, {
    headers: {
      "User-Agent": SEC_USER_AGENT,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`SEC request failed (${res.status} ${res.statusText}): ${url}`);
  }
  return (await res.json()) as T;
}

/** Fetches raw text (HTML/plain) from a SEC EDGAR document URL, throttled and with a real User-Agent. */
export async function secFetchText(url: string): Promise<string> {
  await throttle();
  const res = await fetch(url, {
    headers: {
      "User-Agent": SEC_USER_AGENT,
    },
  });
  if (!res.ok) {
    throw new Error(`SEC request failed (${res.status} ${res.statusText}): ${url}`);
  }
  return await res.text();
}
