// scripts/update-lottery.js
// Robust text/regex parsing (like your working Python RSS script)

import fs from "fs";

const JI_TODAY_URL =
  "https://www.jamaicaindex.com/lottery/jamaica-lotto-results-for-today";

const OUT_PATH = "data/lottery_previews.json";

const DRAW_ORDER = [
  "MORNING",
  "MIDDAY",
  "MIDAFTERNOON",
  "DRIVETIME",
  "EVENING",
  "EARLYBIRD",
];

// Extract: #37091 15 February 2026, Sunday Cash Pot MORNING 20 Sick Person white red
const CASH_POT_RE =
  /#(?<drawNo>\d+)\s+(?<date>\d{1,2}\s+[A-Za-z]+\s+\d{4}),\s+[A-Za-z]+\s+Cash Pot\s+(?<time>EARLYBIRD|MORNING|MIDDAY|MIDAFTERNOON|DRIVETIME|EVENING)\s+(?<num>\d{1,2})\s+(?<label>[A-Za-z ]+?)(?:\s+(?:white|red|gold|green|blue|black|pink|yellow|orange|brown|purple|silver)\b.*)?$/gim;

function normalizeText(html) {
  // Strip tags to text-ish format without needing cheerio
  const withoutScripts = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ");

  const text = withoutScripts
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();

  return text;
}

function pickLatestByOrder(draws) {
  // Most recent = last draw present in DRAW_ORDER sequence
  const byTime = new Map();
  for (const d of draws) byTime.set(d.time, d);

  let latest = null;
  for (const t of DRAW_ORDER) {
    if (byTime.has(t)) latest = byTime.get(t);
  }
  return latest;
}

async function main() {
  const res = await fetch(JI_TODAY_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (GitHub Actions lottery preview updater)",
      "Accept": "text/html,application/xhtml+xml",
    },
  });

  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  const html = await res.text();
  const text = normalizeText(html);

  // Parse Cash Pot draws
  const cashPotDraws = [];
  let m;
  while ((m = CASH_POT_RE.exec(text)) !== null) {
    const g = m.groups || {};
    const time = String(g.time || "").toUpperCase();
    const num = parseInt(g.num, 10);

    if (!time || Number.isNaN(num)) continue;

    cashPotDraws.push({
      draw_no: g.drawNo || null,
      time,
      number: num,
      label: (g.label || "").trim(),
      raw: m[0].trim(),
    });
  }

  // Deduplicate by time (keep latest occurrence)
  const cashPotByTime = new Map();
  for (const d of cashPotDraws) cashPotByTime.set(d.time, d);
  const cashPotUnique = [...cashPotByTime.values()].sort(
    (a, b) => DRAW_ORDER.indexOf(a.time) - DRAW_ORDER.indexOf(b.time)
  );

  const latestCashPot = pickLatestByOrder(cashPotUnique);

  // Try to get date from any cash pot match
  const dateMatch = cashPotUnique.length ? cashPotUnique[0].raw : null;
  const dateParsed = cashPotUnique.length ? (cashPotUnique[0].raw.match(/(\d{1,2}\s+[A-Za-z]+\s+\d{4})/) || [])[1] : null;

  const output = {
    source: JI_TODAY_URL,
    last_updated_utc: new Date().toISOString(),
    games: {
      cash_pot: {
        label: "Cash Pot",
        date: dateParsed || null,
        latest: latestCashPot
          ? {
              time: latestCashPot.time,
              number: latestCashPot.number,
              label: latestCashPot.label,
              draw_no: latestCashPot.draw_no,
            }
          : null,
        draws: cashPotUnique.map((d) => ({
          time: d.time,
          number: d.number,
          label: d.label,
          draw_no: d.draw_no,
        })),
      },
      lotto: {
        label: "Lotto",
        date: null,
        numbers: [],
        bonus: null,
        next_jackpot: null,
      },
      super_lotto: {
        label: "Super Lotto",
        date: null,
        numbers: [],
        bonus: null,
        next_jackpot: null,
      },
    },
  };

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), "utf-8");

  // Helpful action log
  console.log("DATE:", output.games.cash_pot.date);
  console.log("CASH POT DRAWS:", output.games.cash_pot.draws.length);
  console.log("CASH POT LATEST:", output.games.cash_pot.latest);
  console.log("Wrote", OUT_PATH);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
