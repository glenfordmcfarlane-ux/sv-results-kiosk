/* scripts/update-lottery.js (CommonJS) */
const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

const SOURCE_URL = "https://www.jamaicaindex.com/lottery/jamaica-lotto-results-for-today";
const OUT_FILE = path.join(__dirname, "..", "data", "lottery_previews.json");

function nowUtcIso() {
  return new Date().toISOString();
}

// Find the first `count` numbers that appear shortly after a label
function extractNumbersAfterLabel(pageText, label, count, windowSize = 400) {
  const idx = pageText.toLowerCase().indexOf(label.toLowerCase());
  if (idx === -1) return [];

  const windowText = pageText.slice(idx, idx + windowSize);
  const matches = windowText.match(/\b\d{1,2}\b/g) || [];
  return matches.slice(0, count).map(n => Number(n));
}

function extractBonusAfterLabel(pageText, label, windowSize = 500) {
  const idx = pageText.toLowerCase().indexOf(label.toLowerCase());
  if (idx === -1) return null;

  const windowText = pageText.slice(idx, idx + windowSize);

  // Try common patterns like "Bonus 12" or "Bonus: 12"
  const m = windowText.match(/bonus\s*[:\-]?\s*(\d{1,2})/i);
  return m ? Number(m[1]) : null;
}

function extractJackpotAfterLabel(pageText, label, windowSize = 800) {
  const idx = pageText.toLowerCase().indexOf(label.toLowerCase());
  if (idx === -1) return null;

  const windowText = pageText.slice(idx, idx + windowSize);

  // Try to capture something like $12,345,678 or J$12,345,678
  const m = windowText.match(/(?:J\$|\$)\s*[\d,]+(?:\.\d{2})?/i);
  return m ? m[0].replace(/\s+/g, " ").trim() : null;
}

function extractDate(pageText) {
  // Look for common date formats in the page text
  // Examples: "February 15, 2026" or "15 February 2026" etc.
  const patterns = [
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/i,
    /\b\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/i,
    /\b\d{4}-\d{2}-\d{2}\b/ // ISO
  ];

  for (const re of patterns) {
    const m = pageText.match(re);
    if (m) return m[0];
  }
  return null;
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      "accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      "pragma": "no-cache",
    },
  });

  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }
  return await res.text();
}

(async () => {
  try {
    const html = await fetchHtml(SOURCE_URL);
    const $ = cheerio.load(html);

    // Get a big block of readable text from the page
    const pageText = $("body").text().replace(/\s+/g, " ").trim();

    const dateFound = extractDate(pageText);

    // These are the ones shown in your JSON right now
    const cashPotNums = extractNumbersAfterLabel(pageText, "Cash Pot", 5);
    const lottoNums = extractNumbersAfterLabel(pageText, "Lotto", 6);
    const lottoBonus = extractBonusAfterLabel(pageText, "Lotto");
    const lottoJackpot = extractJackpotAfterLabel(pageText, "Lotto");

    const superNums = extractNumbersAfterLabel(pageText, "Super Lotto", 6);
    const superBonus = extractBonusAfterLabel(pageText, "Super Lotto");
    const superJackpot = extractJackpotAfterLabel(pageText, "Super Lotto");

    // Build output in your existing structure
    const output = {
      source: SOURCE_URL,
      last_updated_utc: nowUtcIso(),
      games: {
        cash_pot: {
          label: "Cash Pot",
          date: dateFound,
          latest: cashPotNums.length ? cashPotNums : null,
          draws: [] // keep as-is for now
        },
        lotto: {
          label: "Lotto",
          date: dateFound,
          numbers: lottoNums.length ? lottoNums : [],
          bonus: lottoBonus,
          next_jackpot: lottoJackpot
        },
        super_lotto: {
          label: "Super Lotto",
          date: dateFound,
          numbers: superNums.length ? superNums : [],
          bonus: superBonus,
          next_jackpot: superJackpot
        }
      }
    };

    // Helpful debug in Actions logs
    console.log("DATE:", dateFound);
    console.log("CASH POT:", cashPotNums);
    console.log("LOTTO:", lottoNums, "BONUS:", lottoBonus, "JACKPOT:", lottoJackpot);
    console.log("SUPER LOTTO:", superNums, "BONUS:", superBonus, "JACKPOT:", superJackpot);

    fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), "utf8");
    console.log(`✅ Wrote ${OUT_FILE}`);
  } catch (err) {
    console.error("❌ update-lottery failed:", err);
    process.exit(1);
  }
})();
