import fs from "fs/promises";

const SOURCE_URL =
  "https://www.jamaicaindex.com/lottery/jamaica-lotto-results-for-today";

async function fetchHTML(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return await res.text();
}

function extractBetween(text, start, end) {
  const s = text.indexOf(start);
  if (s === -1) return null;
  const e = text.indexOf(end, s + start.length);
  if (e === -1) return null;
  return text.substring(s + start.length, e);
}

// Helps keep Lotto/Super parsing from grabbing random numbers
function uniqueKeepOrder(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = String(x).trim();
    if (!k) continue;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

function normalizeSpaces(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function matchFullDate(section) {
  // Matches: "Monday | 16 February 2026" or "Friday | 13 February 2026"
  const m = section.match(
    /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*\|\s*\d{1,2}\s+[A-Za-z]+\s+\d{4}/
  );
  return m ? normalizeSpaces(m[0]) : "";
}

/* ===================== CASH POT ===================== */

const CASH_TIMES = [
  "EARLYBIRD",
  "MORNING",
  "MIDDAY",
  "MIDAFTERNOON",
  "DRIVETIME",
  "EVENING",
];

function splitByCashTime(section) {
  // Find each time keyword occurrence index, slice into chunks
  const hits = [];
  for (const t of CASH_TIMES) {
    const re = new RegExp(`\\b${t}\\b`, "g");
    let m;
    while ((m = re.exec(section)) !== null) {
      hits.push({ t, i: m.index });
    }
  }
  hits.sort((a, b) => a.i - b.i);
  const chunks = [];
  for (let k = 0; k < hits.length; k++) {
    const start = hits[k].i;
    const end = k + 1 < hits.length ? hits[k + 1].i : section.length;
    chunks.push({ time: hits[k].t, html: section.slice(start, end) });
  }
  return chunks;
}

function parseCashColors(chunkHtml) {
  // JamaicaIndex shows little boxes with text like "white" "red" "gold"
  const colors = [];
  const re = />\s*(white|red|blue|green|yellow|black|gold)\s*</gi;

  let m;
  while ((m = re.exec(chunkHtml)) !== null) {
    const c = m[1].toLowerCase();
    colors.push(c);
    if (colors.length >= 2) break;
  }

  while (colors.length < 2) colors.push("white");
  return colors.slice(0, 2);
}

function parseCashRow(timeKey, chunkHtml) {
  // clock time like 8:30AM, 10:30AM
  const atMatch = chunkHtml.match(/\b\d{1,2}:\d{2}\s*(AM|PM)\b/i);
  const drawNoMatch = chunkHtml.match(/#\s*(\d{3,})/);

  // First "number" box is the Cash Pot number
  const numberMatch = chunkHtml.match(/>\s*(\d{1,2})\s*<\/div>/);

  // Label appears near the number (Fish, Married, Goat, etc.)
  // Try to capture a word/phrase after the number div
  let label = "";
  if (numberMatch) {
    const idx = chunkHtml.indexOf(numberMatch[0]);
    const tail = idx >= 0 ? chunkHtml.slice(idx + numberMatch[0].length) : "";
    const labelMatch = tail.match(/>\s*([A-Za-z][A-Za-z ]{1,30})\s*</);
    if (labelMatch) label = normalizeSpaces(labelMatch[1]);
  }

  const colors = parseCashColors(chunkHtml);

  if (!numberMatch) return null;

  return {
    time: timeKey,
    at: atMatch ? atMatch[0].replace(/\s+/g, "") : "", // "8:30AM"
    draw_no: drawNoMatch ? drawNoMatch[1] : "",
    number: numberMatch[1],
    label,
    colors, // e.g. ["white","white"] or ["white","red"]
  };
}

async function scrapeCashPot(html) {
  const section = extractBetween(html, "Cash Pot Result", "Cash Pot Result History");
  if (!section) return null;

  const drawDate = matchFullDate(section);

  const chunks = splitByCashTime(section);
  const draws = [];
  for (const c of chunks) {
    const row = parseCashRow(c.time, c.html);
    if (row) draws.push(row);
  }

  // If JamaicaIndex changes, fail gracefully
  if (!draws.length) {
    return {
      title: "Cash Pot",
      drawDate,
      draws: [],
    };
  }

  return {
    title: "Cash Pot",
    drawDate,
    draws,
  };
}

/* ===================== LOTTO ===================== */

async function scrapeLotto(html) {
  const section = extractBetween(html, "Lotto Result", "Lotto Result History");
  if (!section) return null;

  // Date line: "Saturday | 14 February 2026"
  const drawDate = matchFullDate(section);

  // Pull small result number boxes (keep order, unique)
  const rawNums = [...section.matchAll(/>\s*(\d{1,2})\s*<\/div>/g)].map((m) => m[1]);
  const nums = uniqueKeepOrder(rawNums);

  // Lotto: 6 numbers + bonus (7th)
  if (nums.length < 6) return null;

  const jackpotMatch = section.match(/Next Jackpot:\s*\$[0-9A-Za-z.]+/i);

  return {
    title: "Lotto",
    drawDate,
    numbers: nums.slice(0, 6),
    bonus: nums[6] || null,
    next_jackpot: jackpotMatch ? normalizeSpaces(jackpotMatch[0].replace(/^Next Jackpot:\s*/i, "")) : null,
  };
}

/* ===================== SUPER LOTTO ===================== */

async function scrapeSuperLotto(html) {
  const section = extractBetween(html, "Super Lotto Result", "Super Lotto Result History");
  if (!section) return null;

  const drawDate = matchFullDate(section);

  const rawNums = [...section.matchAll(/>\s*(\d{1,2})\s*<\/div>/g)].map((m) => m[1]);
  const nums = uniqueKeepOrder(rawNums);

  // Super Lotto: 5 numbers + bonus (6th)
  if (nums.length < 5) return null;

  const jackpotMatch = section.match(/Next Jackpot:\s*\$[0-9A-Za-z.]+/i);

  return {
    title: "Super Lotto",
    drawDate,
    numbers: nums.slice(0, 5),
    bonus: nums[5] || null,
    next_jackpot: jackpotMatch ? normalizeSpaces(jackpotMatch[0].replace(/^Next Jackpot:\s*/i, "")) : null,
  };
}

/* ===================== RUN ===================== */

async function run() {
  console.log("Fetching Jamaica Index...");
  const html = await fetchHTML(SOURCE_URL);

  const cash_pot = await scrapeCashPot(html);
  const lotto = await scrapeLotto(html);
  const super_lotto = await scrapeSuperLotto(html);

  const output = {
    source: SOURCE_URL,
    last_updated_utc: new Date().toISOString(),
    cash_pot,
    lotto,
    super_lotto,
  };

  await fs.writeFile("./data/lottery_previews.json", JSON.stringify(output, null, 2));
  console.log("lottery_previews.json updated successfully");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

