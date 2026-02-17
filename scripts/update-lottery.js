import fs from 'fs/promises';

const CASH_POT_URL = 'https://www.jamaicaindex.com/lottery/results/cash-pot';
const LOTTO_URL    = 'https://www.jamaicaindex.com/lottery/results/lotto';
const SUPER_URL    = 'https://www.jamaicaindex.com/lottery/results/super-lotto';

async function fetchHTML(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  return await res.text();
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractBetween(text, start, end) {
  const s = text.indexOf(start);
  if (s === -1) return null;
  const e = text.indexOf(end, s + start.length);
  if (e === -1) return null;
  return text.substring(s + start.length, e);
}

/* ------------------------
   CASH POT (multi-draw)
   Output schema:
   cash_pot: { title, drawDate, draws:[{time, at, draw_no, number, label, colors:[c1,c2]}] }
   ------------------------ */
async function scrapeCashPot(html) {
  const text = stripHtml(html);

  // Focus on the "Cash Pot Result" area for the most recent day shown on the page
  const section = extractBetween(text, 'Cash Pot Result', 'What Play in Cash Pot Today');
  if (!section) return null;

  const dateMatch = section.match(
    /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s*\|\s*\d{1,2}\s+[A-Za-z]+\s+\d{4}/
  );
  if (!dateMatch) return null;

  const drawDate = dateMatch[0];

  // Example in text:
  // "EARLYBIRD 8:30AM #37103 30 Fish + white + white"
  const drawRe =
    /(EARLYBIRD|MORNING|MIDDAY|MIDAFTERNOON|DRIVETIME|EVENING)\s+(\d{1,2}(?::\d{2})?(?:AM|PM))\s+#(\d+)\s+(\d{1,2})\s+([A-Za-z ]+?)\s+\+\s+(white|red|gold|blue|green|yellow|black)\s+\+\s+(white|red|gold|blue|green|yellow|black)/gi;

  const draws = [];
  let m;
  while ((m = drawRe.exec(section)) !== null) {
    const timeName = m[1].toUpperCase();
    const at = m[2].toUpperCase();
    const draw_no = m[3];
    const number = m[4];
    const label = m[5].trim();
    const c1 = m[6].toLowerCase();
    const c2 = m[7].toLowerCase();

    draws.push({
      time: timeName,
      at,
      draw_no,
      number,
      label,
      colors: [c1, c2],
    });
  }

  if (!draws.length) return null;

  return {
    title: 'Cash Pot',
    drawDate,
    draws,
    note: '',
  };
}

/* ------------------------
   LOTTO + SUPER LOTTO
   (kept similar, but using their dedicated pages)
   ------------------------ */
async function scrapeLotto(html) {
  const text = stripHtml(html);

  // Usually shows a list; take the top (most recent) block
  // We’ll grab first occurrence of: "11 February 2026, Wednesday Lotto EVENING 3 7 16 17 31 33 + 25"
  const dateMatch = text.match(/\d{1,2}\s+[A-Za-z]+\s+\d{4},\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/);
  const nums = [...text.matchAll(/\b(\d{1,2})\b/g)].map(x => x[1]);

  // Lotto = 6 numbers + 1 bonus, but page contains many numbers; take first 7 after the header area.
  // A safer approach: slice first 7 numbers after "Lotto"
  const idx = text.toLowerCase().indexOf('lotto');
  const after = idx >= 0 ? text.slice(idx) : text;
  const numsAfter = [...after.matchAll(/\b(\d{1,2})\b/g)].map(x => x[1]).slice(0, 7);

  if (!dateMatch || numsAfter.length < 6) return null;

  const jackpotMatch = text.match(/Next Jackpot:\s*\$[0-9A-Za-z]+/i);

  return {
    title: 'Lotto',
    drawDate: dateMatch[0].replace(',', ''),
    numbers: numsAfter.slice(0, 6),
    bonus: numsAfter[6] || null,
    note: jackpotMatch ? jackpotMatch[0] : '',
  };
}

async function scrapeSuperLotto(html) {
  const text = stripHtml(html);

  const dateMatch = text.match(/\d{1,2}\s+[A-Za-z]+\s+\d{4},\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/);

  const idx = text.toLowerCase().indexOf('super lotto');
  const after = idx >= 0 ? text.slice(idx) : text;
  // Super Lotto = 5 numbers + 1 bonus (6 total)
  const numsAfter = [...after.matchAll(/\b(\d{1,2})\b/g)].map(x => x[1]).slice(0, 6);

  if (!dateMatch || numsAfter.length < 5) return null;

  const jackpotMatch = text.match(/Next Jackpot:\s*\$[0-9A-Za-z]+/i);

  return {
    title: 'Super Lotto',
    drawDate: dateMatch[0].replace(',', ''),
    numbers: numsAfter.slice(0, 5),
    bonus: numsAfter[5] || null,
    note: jackpotMatch ? jackpotMatch[0] : '',
  };
}

async function run() {
  console.log('Fetching JamaicaIndex...');

  const [cashHtml, lottoHtml, superHtml] = await Promise.all([
    fetchHTML(CASH_POT_URL),
    fetchHTML(LOTTO_URL),
    fetchHTML(SUPER_URL),
  ]);

  const cashPot = await scrapeCashPot(cashHtml);
  const lotto = await scrapeLotto(lottoHtml);
  const superLotto = await scrapeSuperLotto(superHtml);

  const output = {
    source: {
      cash_pot: CASH_POT_URL,
      lotto: LOTTO_URL,
      super_lotto: SUPER_URL,
    },
    last_updated_utc: new Date().toISOString(),
    cash_pot: cashPot,
    lotto: lotto,
    super_lotto: superLotto,
  };

  await fs.writeFile(
    './data/lottery_previews.json',
    JSON.stringify(output, null, 2)
  );

  console.log('lottery_previews.json updated successfully');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
