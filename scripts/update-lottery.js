/* scripts/update-lottery.js
   Supreme Ventures kiosk preview builder (JamaicaIndex "today" page)
   - CommonJS (no ESM import/export issues)
   - Output keys: cash_pot, lotto, super_lotto (plus games mirror)
*/

const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

const SOURCE_URL = "https://www.jamaicaindex.com/lottery/jamaica-lotto-results-for-today";
const OUT_FILE = path.join(__dirname, "..", "data", "lottery_previews.json");

// Draw times we care about
const CASH_POT_TIMES = ["EARLYBIRD", "MORNING", "MIDDAY", "MIDAFTERNOON", "DRIVETIME", "EVENING"];

function nowUtcIso() {
  return new Date().toISOString();
}

function normalizeSpaces(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function extractSectionText(fullText, startMarker, endMarker) {
  const lower = fullText.toLowerCase();
  const s = lower.indexOf(startMarker.toLowerCase());
  if (s === -1) return "";
  const e = endMarker ? lower.indexOf(endMarker.toLowerCase(), s) : -1;
  return e === -1 ? fullText.slice(s) : fullText.slice(s, e);
}

function parseDateFromSection(sectionText) {
  // Matches: "Monday | 16 February 2026" or "Saturday | 14 February 2026"
  const m = sectionText.match(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*\|\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})\b/i);
  if (!m) return null;
  return normalizeSpaces(`${m[1]} | ${m[2]}`);
}

function parseCashPot(sectionText) {
  // We expect lines like:
  // "EARLYBIRD 8:30AM #37103 30 Fish + white + white"
  // We'll pull: time, draw_no, number, label

  const dateLine = parseDateFromSection(sectionText);

  // Global regex that is tolerant of extra tokens between fields
  const re = new RegExp(
    `\\b(${CASH_POT_TIMES.join("|")})\\b[\\s\\S]{0,80}?#(\\d+)[\\s\\S]{0,80}?\\b(\\d{1,2})\\b\\s+([A-Za-z][A-Za-z ]{0,30})`,
    "gi"
  );

  const draws = [];
  for (const m of sectionText.matchAll(re)) {
    const time = (m[1] || "").toUpperCase();
    const draw_no = m[2] || null;
    const number = m[3] ? parseInt(m[3], 10) : null;
    const label = normalizeSpaces(m[4]);

    // Basic sanity: Cash Pot numbers are 1–36, but keep tolerant
    if (!time || !draw_no || !number || !label) continue;

    draws.push({ time, number, label, draw_no });
  }

  // If JamaicaIndex repeats blocks, keep only the first occurrence per time in order,
  // BUT still set "latest" as the last draw found overall.
  const latest = draws.length ? draws[draws.length - 1] : null;

  const note = latest ? `${latest.label.toUpperCase()} • #${latest.draw_no}` : "";

  return {
    title: "Cash Pot",
    drawDate: dateLine ? dateLine.split("|")[1].trim() : null, // "16 February 2026"
    drawTime: latest ? latest.time : null,
    numbers: latest ? [latest.number] : [],
    bonus: null,
    note,
    // Keep raw structure too (useful for debugging / history view)
    raw: {
      dateLine,
      latest,
      draws
    }
  };
}

function parseLottoLike(sectionText, gameName) {
  // Lotto section text often contains:
  // "Saturday | 14 February 2026 7 8 18 31 32 34 + 24 Next Jackpot: $39M"
  const dateLine = parseDateFromSection(sectionText);

  // Limit number parsing to before "Next Jackpot" to avoid picking digits from jackpot amounts
  const cutoffIdx = sectionText.toLowerCase().indexOf("next jackpot");
  const numberZone = cutoffIdx >= 0 ? sectionText.slice(0, cutoffIdx) : sectionText;

  // Pull ALL small integers in order from that zone
  const nums = (numberZone.match(/\b\d{1,2}\b/g) || []).map(n => parseInt(n, 10));

  // Lotto: 6 + bonus, Super Lotto: 5 + bonus
  const mainCount = gameName.toLowerCase().includes("super") ? 5 : 6;

  const main = nums.slice(0, mainCount);
  const bonus = nums.length > mainCount ? nums[mainCount] : null;

  // Jackpot string
  let jackpot = null;
  const jm = sectionText.match(/Next Jackpot:\s*([$€£]?\s*[0-9.,]+(?:\s*[MK])?)/i);
  if (jm) jackpot = normalizeSpaces(jm[1]).replace(/\s+/g, "");

  const note = jackpot ? `Next Jackpot: ${jackpot}` : "";

  return {
    title: gameName,
    drawDate: dateLine ? dateLine.split("|")[1].trim() : null,
    drawTime: null,
    numbers: main.filter(n => Number.isFinite(n)),
    bonus: Number.isFinite(bonus) ? bonus : null,
    note,
    raw: {
      dateLine,
      jackpot
    }
  };
}

async function fetchHtml(url) {
  // Node 20 has global fetch
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (GitHub Actions; SV kiosk preview generator)"
    }
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  return await res.text();
}

async function main() {
  const html = await fetchHtml(SOURCE_URL);

  // Use cheerio to get a stable “document text” (similar to your RSS approach)
  const $ = cheerio.load(html);
  const fullText = $("body").text().replace(/\r/g, "");
  const text = fullText.split("\n").map(l => l.trim()).filter(Boolean).join("\n");

  // Extract sections by headings
  const cashPotText = extractSectionText(text, "Cash Pot Result", "Lotto Result");
  const lottoText = extractSectionText(text, "Lotto Result", "Super Lotto Result");
  const superLottoText = extractSectionText(text, "Super Lotto Result", null);

  const cash_pot = cashPotText ? parseCashPot(cashPotText) : null;
  const lotto = lottoText ? parseLottoLike(lottoText, "Lotto") : null;
  const super_lotto = superLottoText ? parseLottoLike(superLottoText, "Super Lotto") : null;

  // Build final output in the shape your kiosk expects:
  // json.cash_pot / json.lotto / json.super_lotto
  // plus a mirror json.games for compatibility
  const out = {
    source: SOURCE_URL,
    last_updated_utc: nowUtcIso(),

    // ✅ kiosk-friendly
    cash_pot,
    lotto,
    super_lotto,

    // ✅ backward compatible
    games: {
      cash_pot,
      lotto,
      super_lotto
    }
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), "utf-8");

  // Helpful logs in Actions
  console.log("Wrote:", OUT_FILE);
  console.log("Cash Pot:", cash_pot?.drawDate, cash_pot?.drawTime, cash_pot?.numbers?.[0], cash_pot?.note);
  console.log("Lotto:", lotto?.drawDate, lotto?.numbers?.join(","), "bonus:", lotto?.bonus, lotto?.note);
  console.log("Super Lotto:", super_lotto?.drawDate, super_lotto?.numbers?.join(","), "bonus:", super_lotto?.bonus, super_lotto?.note);
}

main().catch(err => {
  console.error("Update failed:", err);
  process.exit(1);
});
