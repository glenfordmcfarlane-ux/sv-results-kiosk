// scripts/update-lottery.js  (CommonJS - works with your current workflow)
const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

const JI_TODAY_URL =
  "https://www.jamaicaindex.com/lottery/jamaica-lotto-results-for-today";

const OUT_FILE = path.join(__dirname, "..", "data", "lottery_previews.json");

const GAMES = [
  "Cash Pot",
  "Hot Pick",
  "Pick 2",
  "Pick 3",
  "Pick 4",
  "Lucky 5",
  "Top Draw",
  "Dollaz",
  "Lotto",
  "Super Lotto",
  "Money Time",
];

const DRAW_TIMES = [
  "EARLYBIRD",
  "MORNING",
  "MIDDAY",
  "MIDAFTERNOON",
  "DRIVETIME",
  "EVENING",
];

function nowUtcIso() {
  return new Date().toISOString();
}

function compressWhitespace(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function parseBlocksFromText(textWithNewlines) {
  const lines = textWithNewlines
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const big = "\n" + lines.join("\n");

  // Mirror Python: re.split(r"\n-\s*#", "\n" + big)
  const rawBlocks = big.split(/\n-\s*#/);

  const blocks = [];
  for (let b of rawBlocks) {
    b = b.trim();
    if (!b) continue;
    // Python: if not re.match(r"^\d+", b): continue
    if (!/^\d+/.test(b)) continue;
    blocks.push("#" + b);
  }

  return blocks;
}

function detectGame(block) {
  for (const g of GAMES) {
    const re = new RegExp(`\\b${escapeRegExp(g)}\\b`, "i");
    if (re.test(block)) return g;
  }
  return null;
}

function detectDrawTime(block) {
  const re = new RegExp(`\\b(${DRAW_TIMES.join("|")})\\b`, "i");
  const m = block.match(re);
  return m ? m[1].toUpperCase() : null;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseDateLabel(block) {
  // e.g. "15 February 2026" (your RSS shows this pattern)
  const m = block.match(/\b(\d{1,2}\s+[A-Za-z]+\s+\d{4})\b/);
  return m ? m[1] : null;
}

function parseCashPot(block) {
  // Example:
  // "#37091 15 February 2026, Sunday Cash Pot MORNING 20 Sick Person white red"
  const drawNo = (block.match(/#(\d+)/) || [])[1] || null;
  const date = parseDateLabel(block);
  const day = (block.match(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i) || [])[1] || null;
  const drawTime = detectDrawTime(block);

  // After draw time, usually the number appears
  let number = null;
  if (drawTime) {
    const mNum = block.match(new RegExp(`\\b${drawTime}\\b\\s+(\\d{1,2})\\b`, "i"));
    if (mNum) number = mNum[1];
  }

  // Name often follows the number
  // (we'll capture a couple words until we hit known colors)
  const colorRe = /\b(white|red|green|blue|gold|yellow|black|pink|purple|orange|silver)\b/i;
  let name = null;
  let colors = [];

  // Try to capture: "... MORNING 20 Sick Person white red"
  const afterTime = drawTime
    ? block.split(new RegExp(`\\b${drawTime}\\b`, "i"))[1] || ""
    : block;

  // Extract colors from tail
  const colorMatches = afterTime.match(new RegExp(colorRe.source, "gi")) || [];
  colors = colorMatches.map((c) => c.toLowerCase()).slice(-2);

  // Name = words between number and first color (if present)
  if (number) {
    const idxNum = afterTime.toLowerCase().indexOf(String(number).toLowerCase());
    if (idxNum >= 0) {
      const tail = afterTime.slice(idxNum + String(number).length).trim();
      const firstColor = tail.search(colorRe);
      const namePart = firstColor >= 0 ? tail.slice(0, firstColor) : tail;
      name = compressWhitespace(namePart);
      if (name.length > 60) name = name.slice(0, 60);
      if (!name) name = null;
    }
  }

  return {
    draw_no: drawNo,
    date,
    day,
    draw_time: drawTime,
    number,
    name,
    color1: colors[0] || null,
    color2: colors[1] || null,
    raw: compressWhitespace(block).slice(0, 240),
  };
}

function parseLottoLike(block, gameName) {
  // Very defensive parse: collect number tokens after the game name
  // and try to infer 6 main + bonus.
  const date = parseDateLabel(block);

  const idx = block.toLowerCase().indexOf(gameName.toLowerCase());
  const tail = idx >= 0 ? block.slice(idx + gameName.length) : block;

  // pull integers (1-99) in order
  const nums = (tail.match(/\b\d{1,2}\b/g) || []).map((n) => parseInt(n, 10));

  // Some pages include draw number first; remove if it looks like a big draw id
  // (draw ids are usually 4-6 digits; we only captured 1-2 digits, so ignore)

  const main = nums.slice(0, 6);
  const bonus = nums.length >= 7 ? nums[6] : null;

  return {
    date,
    numbers: main.length === 6 ? main : [],
    bonus: bonus ?? null,
    next_jackpot: null, // set later if you find a reliable pattern
    raw: compressWhitespace(block).slice(0, 240),
  };
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (GitHub Actions)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

async function main() {
  const html = await fetchHtml(JI_TODAY_URL);

  // Mirror Python soup.get_text("\n", strip=True)
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\r/g, "");

  const blocks = parseBlocksFromText(text);

  const cashPotDraws = [];
  let lottoBlock = null;
  let superLottoBlock = null;

  for (const b of blocks) {
    const game = detectGame(b);
    if (!game) continue;

    if (game.toLowerCase() === "cash pot") {
      cashPotDraws.push(parseCashPot(b));
    } else if (game.toLowerCase() === "lotto") {
      // keep the first/most recent seen
      if (!lottoBlock) lottoBlock = b;
    } else if (game.toLowerCase() === "super lotto") {
      if (!superLottoBlock) superLottoBlock = b;
    }
  }

  // Sort Cash Pot draws by draw_no desc if present (as strings -> numbers)
  cashPotDraws.sort((a, b) => (parseInt(b.draw_no || "0", 10) - parseInt(a.draw_no || "0", 10)));

  const cashPotLatest = cashPotDraws.length ? cashPotDraws[0] : null;

  const lottoParsed = lottoBlock ? parseLottoLike(lottoBlock, "Lotto") : null;
  const superLottoParsed = superLottoBlock ? parseLottoLike(superLottoBlock, "Super Lotto") : null;

  const payload = {
    source: JI_TODAY_URL,
    last_updated_utc: nowUtcIso(),
    games: {
      cash_pot: {
        label: "Cash Pot",
        date: cashPotLatest?.date || null,
        latest: cashPotLatest
          ? {
              draw_no: cashPotLatest.draw_no,
              draw_time: cashPotLatest.draw_time,
              number: cashPotLatest.number,
              name: cashPotLatest.name,
              color1: cashPotLatest.color1,
              color2: cashPotLatest.color2,
            }
          : null,
        draws: cashPotDraws.slice(0, 30),
      },
      lotto: {
        label: "Lotto",
        date: lottoParsed?.date || null,
        numbers: lottoParsed?.numbers || [],
        bonus: lottoParsed?.bonus ?? null,
        next_jackpot: lottoParsed?.next_jackpot ?? null,
      },
      super_lotto: {
        label: "Super Lotto",
        date: superLottoParsed?.date || null,
        numbers: superLottoParsed?.numbers || [],
        bonus: superLottoParsed?.bonus ?? null,
        next_jackpot: superLottoParsed?.next_jackpot ?? null,
      },
    },
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2), "utf-8");

  // Helpful logs in Actions
  console.log("DATE:", payload.games.cash_pot.date);
  console.log("CASH POT draws:", payload.games.cash_pot.draws.length);
  console.log("LOTTO:", payload.games.lotto.numbers, "BONUS:", payload.games.lotto.bonus);
  console.log("SUPER LOTTO:", payload.games.super_lotto.numbers, "BONUS:", payload.games.super_lotto.bonus);
  console.log("Wrote", OUT_FILE);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
