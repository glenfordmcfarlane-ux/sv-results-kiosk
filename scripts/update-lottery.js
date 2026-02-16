/**
 * Generates /data/lottery_previews.json
 * Source: JamaicaIndex (jamaica-lotto-results-for-today)
 *
 * Output schema (TOP LEVEL):
 * - cash_pot:   { drawDate, drawTime, numbers[], note }
 * - lotto:      { drawDate, numbers[], bonus, jackpot }
 * - super_lotto:{ drawDate, numbers[], bonus, jackpot }
 */

const fs = require("fs");
const path = require("path");

const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
const cheerio = require("cheerio");

const SOURCE_URL = "https://www.jamaicaindex.com/lottery/jamaica-lotto-results-for-today";
const OUT_PATH = path.join(__dirname, "..", "data", "lottery_previews.json");

const DRAW_ORDER = ["EARLYBIRD", "MORNING", "MIDDAY", "MIDAFTERNOON", "DRIVETIME", "EVENING"];

function utcNowIso() {
  return new Date().toISOString();
}

function cleanSpaces(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function findSectionRoot($, titleRegex) {
  // Try: find an element containing the title text, then walk up to a reasonable container.
  const el = $(`*:contains("${titleRegex.source.replace(/\\s\+/g, " ")}")`).filter((_, e) => {
    const t = cleanSpaces($(e).text());
    return titleRegex.test(t);
  }).first();

  if (!el || el.length === 0) return null;

  // Walk up a few parents to get a block/container
  let root = el;
  for (let i = 0; i < 6; i++) {
    const p = root.parent();
    if (!p || p.length === 0) break;

    const txt = cleanSpaces(p.text());
    // heuristic: containers with enough content
    if (txt.length > 120) {
      root = p;
      break;
    }
    root = p;
  }
  return root;
}

function extractDateFromBlockText(blockText) {
  // e.g. "Monday | 16 February 2026" or "Saturday | 14 February 2026"
  const m = blockText.match(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*\|\s*\d{1,2}\s+[A-Za-z]+\s+\d{4}\b/i);
  return m ? cleanSpaces(m[0].replace(/\s*\|\s*/g, " ")) : null;
}

function extractJackpot(blockText) {
  // e.g. "Next Jackpot: $39M" or "Next Jackpot: $316M"
  const m = blockText.match(/Next\s+Jackpot:\s*\$[0-9.,]+\s*[MK]?\b/i);
  if (!m) return null;
  return cleanSpaces(m[0].replace(/^Next\s+Jackpot:\s*/i, ""));
}

function parseCashPot($) {
  // We try to isolate the "Cash Pot Result" area, then locate draw rows.
  const root = findSectionRoot($, /Cash\s+Pot\s+Result/i);
  if (!root) return null;

  const text = cleanSpaces(root.text());
  const drawDate = extractDateFromBlockText(text);

  // Pull candidate rows by searching for draw labels + draw numbers inside the root.
  // We’ll use the HTML inside root to preserve local grouping.
  const rootHtml = root.html() || "";
  const $$ = cheerio.load(rootHtml);

  // Build a list of draw entries found
  const draws = [];
  const rootTextLines = ($$.root().text() || "")
    .split("\n")
    .map(cleanSpaces)
    .filter(Boolean);

  // A flexible regex that catches:
  // EARLYBIRD ... #37103 ... 30 ... Fish
  // We don’t rely on exact DOM classes.
  const drawRegex = /\b(EARLYBIRD|MORNING|MIDDAY|MIDAFTERNOON|DRIVETIME|EVENING)\b[\s\S]{0,120}?#\s*(\d+)[\s\S]{0,120}?\b(\d{1,2})\b[\s\S]{0,120}?\b([A-Za-z][A-Za-z\s]+?)\b/i;

  for (const ln of rootTextLines) {
    const m = ln.match(drawRegex);
    if (m) {
      const time = m[1].toUpperCase();
      const drawNo = m[2];
      const number = m[3];
      const label = cleanSpaces(m[4]).replace(/\bwhite\b|\bred\b|\bgold\b/gi, "").trim(); // strip common color tokens if they leak in
      draws.push({ time, drawNo, number, label });
    }
  }

  // If we didn’t match from lines, do a broader scan over full text.
  if (draws.length === 0) {
    const big = cleanSpaces($$.root().text());
    let m;
    const global = new RegExp(drawRegex.source, "gi");
    while ((m = global.exec(big)) !== null) {
      draws.push({
        time: (m[1] || "").toUpperCase(),
        drawNo: m[2],
        number: m[3],
        label: cleanSpaces(m[4] || "")
      });
    }
  }

  if (draws.length === 0) return null;

  // Choose latest draw by DRAW_ORDER index (fallback to last found)
  draws.sort((a, b) => DRAW_ORDER.indexOf(a.time) - DRAW_ORDER.indexOf(b.time));
  const latest = draws[draws.length - 1];

  return {
    drawDate: drawDate || null,
    drawTime: latest.time || null,
    numbers: latest.number ? [String(latest.number)] : [],
    note: `${latest.label || ""}${latest.drawNo ? ` • #${latest.drawNo}` : ""}`.trim()
  };
}

function parseLottoLike($, titleRegex) {
  const root = findSectionRoot($, titleRegex);
  if (!root) return null;

  const text = cleanSpaces(root.text());
  const drawDate = extractDateFromBlockText(text);
  const jackpot = extractJackpot(text);

  // Numbers: lotto/super lotto are shown as a row of numbers and a bonus after "+"
  // We'll parse the first occurrence of something like: "7 8 18 31 32 34 + 24"
  const m = text.match(/(\d{1,2}(?:\s+\d{1,2}){3,10})\s*\+\s*(\d{1,2})/);
  if (!m) {
    // sometimes bonus might be absent; attempt plain sequence
    const m2 = text.match(/\b(\d{1,2}(?:\s+\d{1,2}){3,10})\b/);
    if (!m2) return null;
    const numsOnly = m2[1].split(/\s+/).map(String);
    return { drawDate: drawDate || null, numbers: numsOnly, bonus: null, jackpot: jackpot || null };
  }

  const nums = m[1].split(/\s+/).map(String);
  const bonus = String(m[2]);

  return {
    drawDate: drawDate || null,
    numbers: nums,
    bonus,
    jackpot: jackpot || null
  };
}

async function main() {
  const res = await fetch(SOURCE_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (GitHub Actions lottery preview generator)" }
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);

  const cashPot = parseCashPot($);
  const lotto = parseLottoLike($, /Lotto\s+Result/i);
  const superLotto = parseLottoLike($, /Super\s+Lotto\s+Result/i);

  const out = {
    source: SOURCE_URL,
    last_updated_utc: utcNowIso(),
    cash_pot: cashPot,
    lotto: lotto,
    super_lotto: superLotto
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), "utf-8");

  console.log("Wrote", OUT_PATH);
  console.log("cash_pot:", cashPot ? "OK" : "NULL");
  console.log("lotto:", lotto ? "OK" : "NULL");
  console.log("super_lotto:", superLotto ? "OK" : "NULL");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
