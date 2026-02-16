import fs from 'fs/promises';

const CASH_POT_URL =
  'https://www.jamaicaindex.com/lottery/jamaica-lotto-results-for-today';

async function fetchHTML(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
    },
  });
  return await res.text();
}

function extractBetween(text, start, end) {
  const s = text.indexOf(start);
  if (s === -1) return null;
  const e = text.indexOf(end, s + start.length);
  if (e === -1) return null;
  return text.substring(s + start.length, e);
}

async function scrapeCashPot(html) {
  const latestSection = extractBetween(
    html,
    'Cash Pot Result',
    'Cash Pot Result History'
  );

  if (!latestSection) return null;

  const dateMatch = latestSection.match(/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday.*?\d{4}/);
  const timeMatch = latestSection.match(/EARLYBIRD|MORNING|MIDDAY|MIDAFTERNOON|DRIVETIME|EVENING/);
  const numberMatch = latestSection.match(/>(\d{1,2})<\/div>/);

  if (!dateMatch || !timeMatch || !numberMatch) return null;

  return {
    title: 'Cash Pot',
    drawDate: dateMatch[0],
    drawTime: timeMatch[0],
    numbers: [numberMatch[1]],
    note: '',
  };
}

async function scrapeLotto(html) {
  const section = extractBetween(
    html,
    'Lotto Result',
    'Lotto Result History'
  );

  if (!section) return null;

  const dateMatch = section.match(/Saturday|Wednesday.*?\d{4}/);
  const numberMatches = [...section.matchAll(/>(\d{1,2})<\/div>/g)]
    .map(m => m[1])
    .slice(0, 7);

  const jackpotMatch = section.match(/Next Jackpot:\s*\$[0-9A-Za-z]+/);

  if (!dateMatch || numberMatches.length < 6) return null;

  return {
    title: 'Lotto',
    drawDate: dateMatch[0],
    numbers: numberMatches.slice(0, 6),
    bonus: numberMatches[6] || null,
    note: jackpotMatch ? jackpotMatch[0] : '',
  };
}

async function scrapeSuperLotto(html) {
  const section = extractBetween(
    html,
    'Super Lotto Result',
    'Super Lotto Result History'
  );

  if (!section) return null;

  const dateMatch = section.match(/Tuesday|Friday.*?\d{4}/);
  const numberMatches = [...section.matchAll(/>(\d{1,2})<\/div>/g)]
    .map(m => m[1])
    .slice(0, 6);

  const jackpotMatch = section.match(/Next Jackpot:\s*\$[0-9A-Za-z]+/);

  if (!dateMatch || numberMatches.length < 5) return null;

  return {
    title: 'Super Lotto',
    drawDate: dateMatch[0],
    numbers: numberMatches.slice(0, 5),
    bonus: numberMatches[5] || null,
    note: jackpotMatch ? jackpotMatch[0] : '',
  };
}

async function run() {
  console.log('Fetching Jamaica Index...');
  const html = await fetchHTML(CASH_POT_URL);

  const cashPot = await scrapeCashPot(html);
  const lotto = await scrapeLotto(html);
  const superLotto = await scrapeSuperLotto(html);

  const output = {
    source: CASH_POT_URL,
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
