/**
 * scripts/update-lottery.js
 * Fetches JamaicaIndex results pages and writes data/lottery_previews.json
 *
 * Node 20+ recommended (global fetch available).
 */

import fs from "fs";
import path from "path";
import { load } from "cheerio";

const OUT_FILE = path.join(process.cwd(), "data", "lottery_previews.json");

// Use pages that consistently contain the results content:
const SOURCES = {
  cash_pot: "https://www.jamaicaindex.com/lottery/results/cash-pot",
  lotto: "https://www.jamaicaindex.com/lottery/results/lotto",
  super_lotto: "https://www.jamaicaindex.com/lottery/results/super-lotto",
};

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      // Helps avoid simple bot blocks / empty responses
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!res.ok) {
    throw new Error(`Fetch failed ${res.status} ${res.statusText} for ${url}`);
  }
  return await res.text();
}

function normalizeText(html) {
  const $ = load(html);
  // Body text is enough for these pages
  const txt = $("body").text();
  return txt.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\s+\n/g, "\n").trim();
}

function parseLottoLike(text, headingLabel) {
  // Example layout in text:
  // "Lotto Draw Result" / "Super Lotto"
  // "Saturday | 14 February 2026"
  // "1 2 3 4 5 6 + 7"
  // "Next Jackpot JMD ..."
  //
  // We’ll grab the first date+numbers block after the page heading.
  const dateMatch = text.match(
    /([A-Za-z]+)\s*\|\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/
  );
  if (!dateMatch) return null;

  const date = `${dateMatch[1]} | ${dateMatch[2]}`;

  // Find the first "6 numbers + bonus" pattern after the date
  const idx = text.indexOf(dateMatch[0]);
  const afterDate = idx >= 0 ? text.slice(idx) : text;

  // 6 numbers then "+" then bonus
  const numsMatch = afterDate.match(
    /(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s*\+\s*(\d{1,2})/
  );
  if (!numsMatch) return null;

  const numbers = numsMatch.slice(1, 7).map((n) => Number(n));
  const bonus = Number(numsMatch[7]);

  // Next jackpot (optional)
  let nextJackpot = null;
  const jackpotMatch = afterDate.match(/Next Jackpot\s+([A-Za-z]{3}\s*[\d,.\s]+(?:million|billion)?)/i);
  if (jackpotMatch) nextJackpot = jackpotMatch[1].trim();

  return {
    label: headingLabel,
    date,
    numbers,
    bonus,
    next_jackpot: nextJackpot,
  };
}

function parseCashPot(text) {
  // Text contains:
  // "Sunday | 15 February 2026"
  // "EARLYBIRD 8:30AM #37097 4 Egg + gold + red"
  const dateMatch = text.match(/([A-Za-z]+)\s*\|\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/);
  if (!dateMatch) return null;

  const date = `${dateMatch[1]} | ${dateMatch[2]}`;
  const idx = text.indexOf(dateMatch[0]);
  const afterDate = idx >= 0 ? text.slice(idx) : text;

  const drawRegex =
    /\b(EARLYBIRD|MORNING|MIDDAY|MIDAFTERNOON|DRIVETIME|EVENING)\s+(\d{1,2}:\d{2}\s?(?:AM|PM))\s*(?:#(\d+))?\s+(\d{1,2}|\?)\s+([A-Za-z ]+?)\s*\+\s*(gold|red|white|\?)\s*\+\s*(gold|red|white|\?)/gi;

  const draws = [];
  let m;
  while ((m = drawRegex.exec(afterDate)) !== null) {
    const drawName = m[1].toUpperCase();
    const time = m[2].toUpperCase().replace(/\s+/g, "");
    const drawNo = m[3] ? m[3] : null;

    const num = m[4] === "?" ? null : Number(m[4]);
    const meaning = m[5].trim();
    const color1 = m[6] === "?" ? null : m[6].toLowerCase();
    const color2 = m[7] === "?" ? null : m[7].toLowerCase();

    draws.push({
      draw: drawName,
      time,
      draw_no: drawNo,
      number: num,
      meaning,
      colors: [color1, color2].filter(Boolean),
    });
  }

  // If nothing matched, return at least the date
  return {
    label: "Cash Pot",
    date,
    latest: draws.length ? draws[draws.length - 1] : null,
    draws,
  };
}

async function main() {
  const now = new Date().toISOString();

  const [cashHtml, lottoHtml, superHtml] = await Promise.all([
    fetchHtml(SOURCES.cash_pot),
    fetchHtml(SOURCES.lotto),
    fetchHtml(SOURCES.super_lotto),
  ]);

  const cashText = normalizeText(cashHtml);
  const lottoText = normalizeText(lottoHtml);
  const superText = normalizeText(superHtml);

  const cash = parseCashPot(cashText);
  const lotto = parseLottoLike(lottoText, "Lotto");
  const superLotto = parseLottoLike(superText, "Super Lotto");

  const output = {
    source: SOURCES,               // keep all source URLs
    last_updated_utc: now,
    games: {
      cash_pot: cash ?? { label: "Cash Pot", date: null, latest: null, draws: [] },
      lotto: lotto ?? { label: "Lotto", date: null, numbers: [], bonus: null, next_jackpot: null },
      super_lotto: superLotto ?? { label: "Super Lotto", date: null, numbers: [], bonus: null, next_jackpot: null },
    },
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), "utf8");

  console.log("✅ Wrote:", OUT_FILE);
  console.log("CashPot draws:", output.games.cash_pot.draws.length);
  console.log("Lotto numbers:", output.games.lotto.numbers);
  console.log("Super Lotto numbers:", output.games.super_lotto.numbers);
}

main().catch((err) => {
  console.error("❌ update-lottery failed:", err);
  process.exit(1);
});
