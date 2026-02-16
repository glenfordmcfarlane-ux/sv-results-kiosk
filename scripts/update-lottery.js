import fs from "fs/promises";

const SOURCE_URL =
  "https://www.jamaicaindex.com/lottery/jamaica-lotto-results-for-today";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

function extractBetween(text, start, end) {
  const s = text.indexOf(start);
  if (s === -1) return null;
  const e = text.indexOf(end, s + start.length);
  if (e === -1) return null;
  return text.substring(s, e);
}

function cleanText(s) {
  return (s || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickFirstMatch(section, regex) {
  const m = section.match(regex);
  return m ? m[0] : null;
}

function pickCapture(section, regex, idx = 1) {
  const m = section.match(regex);
  return m ? m[idx] : null;
}

/**
 * Pulls all 1–2 digit numbers from “ball-like” divs/spans (more reliable than >(\d{1,2})</div> globally).
 * We still keep it regex-only (no deps), but constrain to tags that commonly wrap the balls.
 */
function extractBallNumbers(section) {
  const matches = [...section.matchAll(/<(?:div|span)[^>]*>\s*(\d{1,2})\s*<\/(?:div|span)>/gi)];
  return matches.map((m) => m[1]);
}

async function fetchHTML(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25_000);

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "text/html" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

/**
 * Common date formats on JamaicaIndex look like:
 * "Monday | 16 February 2026"
 * "Saturday | 14 February 2026"
 */
function extractFullDate(section) {
  // Prefer the exact "Day | DD Month YYYY" pattern
  const d = pickCapture(
    section,
    /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b\s*\|\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i,
    0
  );
  if (d) return cleanText(d);

  // Fallback: any "DD Month YYYY"
  const fallback = pickCapture(section, /\b(\d{1,2}\s+[A-Za-z]+\s+\d{4})\b/i, 1);
  return fallback ? cleanText(fallback) : "";
}

function extractJackpot(section) {
  // e.g. "Next Jackpot: $39M" or "$316M"
  const m = pickCapture(section, /Next\s+Jackpot:\s*(\$\s?[0-9.,]+[A-Za-z]*)/i, 1);
  return m ? `Next Jackpot: ${m.replace(/\s+/g, "")}` : "";
}

function extractCashPotDrawTime(section) {
  // Use the draw label (EARLYBIRD/MORNING/...) if present
  const m = pickCapture(section, /\b(EARLYBIRD|MORNING|MIDDAY|MIDAFTERNOON|DRIVETIME|EVENING)\b/i, 1);
  return m ? m.toUpperCase() : "";
}

function scrapeCashPot(html) {
  const sec = extractBetween(html, "Cash Pot Result", "Cash Pot Result History");
  if (!sec) return null;

  const drawDate = extractFullDate(sec);

  // The first ball number on Cash Pot sections is usually the result number.
  const balls = extractBallNumbers(sec);
  const number = balls.length ? balls[0] : null;

  // Try to capture the “label” like Fish/Goat/etc if present (based on the site layout)
  // Keep it optional so we never fail parsing if it changes.
  const label = (() => {
    // heuristics: a short word near the number row; keep safe
    const txt = cleanText(sec);
    // Look for common pattern where the label appears close to the number; not guaranteed.
    // If this returns junk, it will be empty and your UI still works.
    const m = txt.match(/\b(Fish|Goat|Dog|Race Horse|White Woman|Black Man|Married|Sick Person|Mouth|Duppy|Fresh Water)\b/i);
    return m ? m[0] : "";
  })();

  // Draw number like "#37103"
  const drawNo = pickCapture(sec, /#\s?(\d{4,6})/i, 1);

  return {
    title: "Cash Pot",
    drawDate: drawDate,
    drawTime: extractCashPotDrawTime(sec),
    numbers: number ? [number] : [],
    note: [label, drawNo ? `#${drawNo}` : ""].filter(Boolean).join(" • "),
  };
}

function scrapeLotto(html) {
  const sec = extractBetween(html, "Lotto Result", "Lotto Result History");
  if (!sec) return null;

  const drawDate = extractFullDate(sec);
  const balls = extractBallNumbers(sec);

  // Lotto = 6 numbers + bonus
  const main = balls.slice(0, 6);
  const bonus = balls.length >= 7 ? balls[6] : null;

  if (main.length < 6) return null;

  return {
    title: "Lotto",
    drawDate,
    drawTime: "",
    numbers: main,
    bonus,
    note: extractJackpot(sec),
  };
}

function scrapeSuperLotto(html) {
  const sec = extractBetween(html, "Super Lotto Result", "Super Lotto Result History");
  if (!sec) return null;

  const drawDate = extractFullDate(sec);
  const balls = extractBallNumbers(sec);

  // Super Lotto = 5 numbers + bonus
  const main = balls.slice(0, 5);
  const bonus = balls.length >= 6 ? balls[5] : null;

  if (main.length < 5) return null;

  return {
    title: "Super Lotto",
    drawDate,
    drawTime: "",
    numbers: main,
    bonus,
    note: extractJackpot(sec),
  };
}

async function run() {
  console.log("Fetching JamaicaIndex…");
  const html = await fetchHTML(SOURCE_URL);

  const cashPot = scrapeCashPot(html);
  const lotto = scrapeLotto(html);
  const superLotto = scrapeSuperLotto(html);

  const output = {
    source: SOURCE_URL,
    last_updated_utc: new Date().toISOString(),
    cash_pot: cashPot,
    lotto: lotto,
    super_lotto: superLotto,
  };

  await fs.writeFile("./data/lottery_previews.json", JSON.stringify(output, null, 2));
  console.log("✅ data/lottery_previews.json updated");
}

run().catch((err) => {
  console.error("❌ update-lottery failed:", err);
  process.exit(1);
});
