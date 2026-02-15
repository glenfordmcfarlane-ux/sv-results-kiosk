/**
 * Update lottery preview JSON by scraping jamaicaindex "results for today".
 * Writes: data/lottery_previews.json
 *
 * Requires: npm i cheerio
 */
import fs from "fs";
import path from "path";
import cheerio from "cheerio";

const SOURCE_URL = "https://www.jamaicaindex.com/lottery/jamaica-lotto-results-for-today";
const OUT_FILE = path.join(process.cwd(), "data", "lottery_previews.json");

function nowUtcIso() {
  return new Date().toISOString();
}

function normalizeText(s) {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function parseDateFromTimeTag($, $scope) {
  // <time datetime="2026-02-15"><b>Sunday</b> | 15 February 2026</time>
  const $t = $scope.find("time[datetime]").first();
  const iso = normalizeText($t.attr("datetime"));
  const label = normalizeText($t.text());
  return { iso: iso || null, label: label || null };
}

function parseMoney(s) {
  const t = normalizeText(s);
  if (!t) return null;
  // keep as string (e.g., "$39M", "$316M", "$200,000.00") since site varies
  return t;
}

function parseCashPotToday($) {
  // First v2_lotto_con is Cash Pot Result
  const $cash = $("h2:contains('Cash Pot Result')")
    .closest(".v2_lotto_con")
    .first();

  if (!$cash.length) {
    return { date: null, latest: null, draws: [] };
  }

  const d = parseDateFromTimeTag($, $cash);

  const draws = [];
  // Each draw has .numbers_title_with_b then the next .lotto_numbers
  $cash.find(".numbers_title_with_b").each((_, el) => {
    const $title = $(el);
    const titleText = normalizeText($title.text()); // e.g. "EARLYBIRD 8:30AM #37097"
    const drawName = normalizeText($title.find("b").first().text()) || null;

    const drawNo = normalizeText($title.find(".draw_no").first().text()).replace("#", "") || null;

    // Try to extract time (whatever is between draw name and draw no)
    // Example HTML: "<b>EARLYBIRD</b>  8:30AM <span class='draw_no'>#37097</span>"
    const titleClone = $title.clone();
    titleClone.find(".draw_no").remove();
    titleClone.find("b").remove();
    const timeText = normalizeText(titleClone.text()) || null;

    const $nums = $title.next(".lotto_numbers");
    if (!$nums.length) return;

    // First numeric ball (may be "?" if not drawn)
    const number = normalizeText($nums.find(".lotto_no_r, .lotto_no_w").first().text()) || null;

    // Second item in that row is usually the “thing” name (Egg, Married Woman, etc.)
    // It uses class lotto_plus2 on site.
    const pickName =
      normalizeText($nums.find(".lotto_plus2").first().text()) ||
      null;

    // Colors (gold/red/white) appear as text in elements like .lotto_no_gold / .lotto_no_red / .lotto_no_white
    const colors = [];
    $nums
      .find(".lotto_no_gold, .lotto_no_red, .lotto_no_white")
      .each((__, c) => {
        const col = normalizeText($(c).text());
        if (col) colors.push(col);
      });

    draws.push({
      draw: drawName,     // EARLYBIRD, MORNING, etc.
      time: timeText,     // 8:30AM, 10:30AM, 1PM, etc.
      draw_no: drawNo,    // 37097, etc. (null for evening until posted)
      number: number,     // "4" or "?"
      name: pickName,     // "Egg" or null
      colors: colors.length ? colors : null,
      raw: titleText || null,
    });
  });

  // latest = most recent completed draw with a real number (not "?")
  const latest = [...draws]
    .reverse()
    .find((x) => x.number && x.number !== "?" && x.draw_no);

  return {
    date: d.iso,
    latest: latest
      ? { draw: latest.draw, time: latest.time, draw_no: latest.draw_no, number: latest.number, name: latest.name, colors: latest.colors }
      : null,
    draws,
  };
}

function parseLottoBlock($, headingText) {
  // Finds the "Lotto Result" or "Super Lotto Result" blocks in the "Today Results" section.
  const $block = $(`h2:contains('${headingText}')`).closest(".v2_lotto_con").first();
  if (!$block.length) {
    return { date: null, numbers: [], bonus: null, next_jackpot: null };
  }

  const d = parseDateFromTimeTag($, $block);

  // numbers are red balls (bbb1.. etc) inside .lotto_numbers
  const numbers = [];
  $block.find(".lotto_numbers .lotto_no_r").each((_, el) => {
    const v = normalizeText($(el).text());
    if (v && v !== "+") numbers.push(v);
  });

  // bonus number is sometimes styled "lotto_no_hot" (after a "+")
  const bonus = normalizeText($block.find(".lotto_numbers .lotto_no_hot").first().text()) || null;

  // Next Jackpot appears in ".lotto_jackpot" as text like "Next Jackpot: $39M"
  const jackpotText = normalizeText($block.find(".lotto_jackpot").text());
  const next_jackpot = jackpotText
    ? parseMoney(jackpotText.replace(/.*Next Jackpot:\s*/i, "").split("View Jackpot Tracker")[0])
    : null;

  return { date: d.iso, numbers, bonus, next_jackpot };
}

async function main() {
  const res = await fetch(SOURCE_URL, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (compatible; sv-results-kiosk/1.0; +https://github.com/)",
    },
  });

  if (!res.ok) {
    throw new Error(`Fetch failed ${res.status}: ${res.statusText}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  const cash = parseCashPotToday($);
  const lotto = parseLottoBlock($, "Lotto Result");
  const superLotto = parseLottoBlock($, "Super Lotto Result");

  const out = {
    source: SOURCE_URL,
    last_updated_utc: nowUtcIso(),
    games: {
      cash_pot: {
        label: "Cash Pot",
        date: cash.date,
        latest: cash.latest,
        draws: cash.draws,
      },
      lotto: {
        label: "Lotto",
        date: lotto.date,
        numbers: lotto.numbers,
        bonus: lotto.bonus,
        next_jackpot: lotto.next_jackpot,
      },
      super_lotto: {
        label: "Super Lotto",
        date: superLotto.date,
        numbers: superLotto.numbers,
        bonus: superLotto.bonus,
        next_jackpot: superLotto.next_jackpot,
      },
    },
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), "utf8");
  console.log(`Updated: ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
