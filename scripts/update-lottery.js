const fs = require("fs");
const cheerio = require("cheerio");

// Source page
const SOURCE_URL =
  "https://www.jamaicaindex.com/lottery/jamaica-lotto-results-for-today";

/**
 * CONFIG: Add/remove games here (this is what makes it easy to switch previews)
 * key: how you reference it in your kiosk
 * heading: the exact H2 text on the page
 * type: "multi" (many draws like Cash Pot) or "single" (one draw like Lotto)
 */
const GAMES = [
  { key: "cash_pot", label: "Cash Pot", heading: "Cash Pot Result", type: "multi" },
  { key: "lotto", label: "Lotto", heading: "Lotto Result", type: "single" },
  { key: "super_lotto", label: "Super Lotto", heading: "Super Lotto Result", type: "single" },
];

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (ResultsKioskBot)",
      "Accept": "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} ${res.statusText}`);
  return await res.text();
}

// Get all text between this <h2> section and the next <h2>
function getSectionNodes($, headingText) {
  const h2 = $("h2")
    .filter((_, el) => $(el).text().trim() === headingText)
    .first();

  if (!h2.length) return null;

  const nodes = [];
  let cur = h2.next();

  while (cur.length) {
    if (cur.is("h2")) break;
    nodes.push(cur);
    cur = cur.next();
  }
  return nodes;
}

function extractDateFromNodes($, nodes) {
  // Page shows lines like: "Saturday | 14 February 2026"
  for (const n of nodes) {
    const t = $(n).text().replace(/\s+/g, " ").trim();
    if (t.includes("|")) return t;
  }
  return null;
}

function extractNextJackpotFromNodes($, nodes) {
  for (const n of nodes) {
    const t = $(n).text().replace(/\s+/g, " ").trim();
    if (t.toLowerCase().includes("next jackpot:")) return t.replace(/^.*?(Next Jackpot:)/i, "$1");
  }
  return null;
}

function extractNumbersFromText(text) {
  // pulls integers like 3 7 16 17 31 33 25 etc
  const matches = text.match(/\b\d+\b/g);
  return matches ? matches.map(Number) : [];
}

function parseSingleDraw($, nodes) {
  const allText = nodes.map(n => $(n).text()).join("\n");
  const nums = extractNumbersFromText(allText);

  // Lotto & Super Lotto on this page appear as 6 main + 1 bonus
  // If we have >=7 numbers, treat last as bonus
  let numbers = nums;
  let bonus = null;

  if (nums.length >= 7) {
    numbers = nums.slice(0, 6);
    bonus = nums[6];
  } else if (nums.length >= 6) {
    numbers = nums.slice(0, 6);
  }

  return { numbers, bonus };
}

function parseMultiDraw($, nodes) {
  // Cash Pot format repeats labels like EARLYBIRD/MORNING/MIDDAY etc then a number line
  const textLines = [];
  for (const n of nodes) {
    const t = $(n).text().replace(/\s+/g, " ").trim();
    if (t) textLines.push(t);
  }

  // Build draw entries by scanning lines:
  // We look for known draw labels and then the next numeric token
  const drawLabels = [
    "EARLYBIRD",
    "MORNING",
    "MIDDAY",
    "MIDAFTERNOON",
    "DRIVETIME",
    "EVENING",
  ];

  const draws = [];
  for (let i = 0; i < textLines.length; i++) {
    const line = textLines[i];
    const hit = drawLabels.find(lbl => line.toUpperCase().startsWith(lbl));
    if (!hit) continue;

    // Find the next line(s) that contain a number or "?"
    let value = null;
    for (let j = i + 1; j < Math.min(i + 6, textLines.length); j++) {
      const candidate = textLines[j];
      const m = candidate.match(/\b(\d+)\b/);
      if (m) {
        value = Number(m[1]);
        break;
      }
      if (candidate.includes("?")) {
        value = null;
        break;
      }
    }

    draws.push({ draw: hit, value });
  }

  // Pick the most recent completed draw (last draw with a number)
  const latestComplete = [...draws].reverse().find(d => typeof d.value === "number") || null;

  return { draws, latestComplete };
}

async function updateLottery() {
  const html = await fetchHtml(SOURCE_URL);
  const $ = cheerio.load(html);

  const output = {
    source: SOURCE_URL,
    last_updated_utc: new Date().toISOString(),
    games: {},
  };

  for (const g of GAMES) {
    const nodes = getSectionNodes($, g.heading);
    if (!nodes) {
      output.games[g.key] = { label: g.label, error: `Section not found: ${g.heading}` };
      continue;
    }

    const dateText = extractDateFromNodes($, nodes);
    const nextJackpot = extractNextJackpotFromNodes($, nodes);

    if (g.type === "single") {
      const draw = parseSingleDraw($, nodes);
      output.games[g.key] = {
        label: g.label,
        date: dateText,
        numbers: draw.numbers,
        bonus: draw.bonus,
        next_jackpot: nextJackpot,
      };
    } else {
      const multi = parseMultiDraw($, nodes);
      output.games[g.key] = {
        label: g.label,
        date: dateText,
        latest: multi.latestComplete, // { draw, value }
        draws: multi.draws,           // array
      };
    }
  }

  fs.writeFileSync("data/lottery_previews.json", JSON.stringify(output, null, 2));
  console.log("Updated data/lottery_previews.json");
}

updateLottery().catch((err) => {
  console.error("Update failed:", err);
  process.exit(1);
});
