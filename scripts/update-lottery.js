import fs from "fs";
import * as cheerio from "cheerio";

const SOURCE_URL = "https://www.jamaicaindex.com/lottery/jamaica-lotto-results-for-today";

function cleanText(s) {
  return s.replace(/\s+/g, " ").trim();
}

// Extract ALL Cash Pot lines like:
// "#37091 15 February 2026, Sunday Cash Pot MORNING 20 Sick Person white red"
function extractCashPotLines(text) {
  const re = /#\d+\s+\d{1,2}\s+\w+\s+\d{4},\s+\w+\s+Cash Pot\s+\w+\s+\d+\s+[^#]+?(?=\s+#\d+|\s*$)/g;
  return (text.match(re) || []).map(cleanText);
}

function parseCashPotDraw(line) {
  // Example:
  // #37091 15 February 2026, Sunday Cash Pot MORNING 20 Sick Person white red
  const m = line.match(/^#(\d+)\s+(\d{1,2}\s+\w+\s+\d{4}),\s+\w+\s+Cash Pot\s+(\w+)\s+(\d+)\s+(.*)$/);
  if (!m) return null;
  return {
    draw_no: m[1],
    date: m[2],
    session: m[3],     // MORNING / MIDDAY / etc
    number: Number(m[4]),
    extra: m[5]        // "Sick Person white red"
  };
}

async function main() {
  const res = await fetch(SOURCE_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "text/html,application/xhtml+xml"
    }
  });
  const html = await res.text();
  const $ = cheerio.load(html);
  const bodyText = cleanText($("body").text());

  // CASH POT
  const cashPotLines = extractCashPotLines(bodyText);
  const cashPotDraws = cashPotLines.map(parseCashPotDraw).filter(Boolean);

  // Build your output structure
  const out = {
    source: SOURCE_URL,
    last_updated_utc: new Date().toISOString(),
    games: {
      cash_pot: {
        label: "Cash Pot",
        date: cashPotDraws[0]?.date ?? null,
        latest: cashPotDraws[0]?.number ?? null,
        draws: cashPotDraws
      },
      lotto: { label: "Lotto", date: null, numbers: [], bonus: null, next_jackpot: null },
      super_lotto: { label: "Super Lotto", date: null, numbers: [], bonus: null, next_jackpot: null }
    }
  };

  fs.writeFileSync("data/lottery_previews.json", JSON.stringify(out, null, 2), "utf8");
  console.log("CASH POT draws:", cashPotDraws.length);
  console.log("Wrote data/lottery_previews.json");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
