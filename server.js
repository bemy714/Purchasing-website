// server.js 實作多組 ExchangeRate-API 金鑰自動切換
const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = 3000;

// ==========================
// ★ 這裡填入你自己的 API KEY 列表！（可多個, 無上限）
const API_KEYS = [
  '75596fcb43bae1c780c1b6e1',
  '5f6ae886937e991b9eb8c222',
  '999172ad49ef5c645742aa0c',
  //'第四組API',
];
// ==========================

const CONFIG = {
  spread: 0.5,        // 匯差
  fee: 50,            // 每筆手續費
  taxRate: 0.01       // 營業稅
};

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ----------- 多金鑰自動輪替呼叫 ExchangeRate-API ------------
async function fetchRateWithFallback(base, target) {
  for (let key of API_KEYS) {
    try {
      const url = `https://v6.exchangerate-api.com/v6/${key}/latest/${base}`;
      const response = await fetch(url);
      if (!response.ok) continue;
      const data = await response.json();
      // 只抓成功且有匯率的
      if (
        data.result === 'success' &&
        data.conversion_rates &&
        data.conversion_rates[target]
      ) {
        return {
          rate: data.conversion_rates[target],
          lastUpdated: new Date(data.time_last_update_unix * 1000)
        };
      }
    } catch (err) {
      // 串接錯誤 (網路, 格式等) 自動跳過換下一組
      continue;
    }
  }
  throw new Error('目前無法讀取即時匯率，請與代購商回報。');
}

// ------- 匯率快取（可選，如果你頻繁查詢API，建議加入快取！） --------
// (進階如要，歡迎再問，目前預設直接即時查詢)


// ----------- 匯率查詢（前端可用 get /api/rate?base=USD&target=TWD）-----------
app.get('/api/rate', async (req, res) => {
  const base = req.query.base || 'HKD';
  const target = req.query.target || 'TWD';
  try {
    const result = await fetchRateWithFallback(base, target);
    const quoteRate = result.rate + CONFIG.spread;
    res.json({
      quoteRate,
      apiRate: result.rate,
      lastUpdated: result.lastUpdated
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ----------- 主運算 API（前端 /api/calculate）-----------
app.post('/api/calculate', async (req, res) => {
  try {
    const { amount, direction, base, target } = req.body;
    if (amount === undefined || !direction || !base || !target) {
      return res.status(400).json({ error: '缺少參數' });
    }
    const result = await fetchRateWithFallback(base, target);
    const quoteRate = result.rate + CONFIG.spread;
    const apiRate = result.rate;

    let finalTwd = 0, finalForeign = 0, baseTwd = 0;
    if (direction === 'foreignToTwd') {
      finalForeign = parseFloat(amount);
      baseTwd = finalForeign * quoteRate;
      finalTwd = Math.ceil(baseTwd + CONFIG.fee + (baseTwd + CONFIG.fee) * CONFIG.taxRate);
    } else if (direction === 'twdToForeign') {
      finalTwd = parseFloat(amount);
      const subtotal = finalTwd / (1 + CONFIG.taxRate);
      baseTwd = subtotal - CONFIG.fee;
      finalForeign = Math.floor(baseTwd / quoteRate);
    } else {
      return res.status(400).json({ error: 'direction 參數錯誤' });
    }
    res.json({
      finalTwd,
      finalForeign,
      baseTwd: Math.round(baseTwd),
      fee: CONFIG.fee,
      tax: Math.ceil((baseTwd + CONFIG.fee) * CONFIG.taxRate),
      quoteRate,
      apiRate,
      lastUpdated: result.lastUpdated
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ----------- 伺服器啟動訊息 -----------
app.listen(PORT, () => {
  console.log(`\n伺服器已成功啟動！`);
  console.log(`✅ 請在您的瀏覽器中打開這個網址: http://localhost:${PORT}`);
  console.log(`(請保持這個終端機視窗開啟，以維持伺服器運行)`);
});
