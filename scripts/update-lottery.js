const fs = require("fs");
const cheerio = require("cheerio");
// Node 18+ has built-in fetch (no need for node-fetch)

const URL = "https://www.jamaicaindex.com/lottery/jamaica-lotto-results-for-today";

async function updateLottery() {
  try {
    const response = await fetch(URL);
    const html = await response.text();
    const $ = cheerio.load(html);

    // ---- EXAMPLE PARSING (will adjust if structure changes) ----
    const lottoNumbers = [];
    $(".lottery-ball").each((i, el) => {
      lottoNumbers.push($(el).text().trim());
    });

    const data = {
      last_updated: new Date().toISOString(),
      cash_pot: {
        draw_time: "Today",
        numbers: lottoNumbers.slice(0, 5),
        jackpot: ""
      },
      lotto: {
        draw_date: "Today",
        numbers: lottoNumbers.slice(0, 6),
        bonus: "",
        jackpot: ""
      },
      super_lotto: {
        draw_date: "Today",
        numbers: lottoNumbers.slice(0, 6),
        bonus: "",
        jackpot: ""
      }
    };

    fs.writeFileSync("data/lottery_previews.json", JSON.stringify(data, null, 2));
    console.log("Lottery preview updated successfully");
  } catch (err) {
    console.error("Error updating lottery:", err);
  }
}

updateLottery();
