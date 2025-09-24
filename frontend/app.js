const base = window.location.origin;
let token = localStorage.getItem("token") || "";
let username = localStorage.getItem("username") || "";

// ---- Register candlestick/ohlc controllers ----
if (window.CandlestickController && window.CandlestickElement) {
  Chart.register(window.CandlestickController, window.CandlestickElement);
}
if (window.OhlcController && window.OhlcElement) {
  Chart.register(window.OhlcController, window.OhlcElement);
}

// ---------------- Helper ----------------
function createStockItem(stock) {
  return `
  <li class="stock-item" data-symbol="${stock.symbol}">
      <div class="stock-symbol">${stock.symbol}</div>
      <div class="stock-price">₹${stock.price?.toFixed(2) || '-'}</div>
      <div class="stock-change ${parseFloat(stock.change) > 0 ? 'positive' : 'negative'}">
          ${stock.change || '-'}
      </div>
      <div class="stock-details">
          <span>H: ₹${stock.dayHigh?.toFixed(2) || '-'}</span>
          <span>L: ₹${stock.dayLow?.toFixed(2) || '-'}</span>
          <span>Vol: ${(stock.volume/1000000)?.toFixed(2) || '-'}M</span>
      </div>
      <button class="btn-show-chart" data-symbol="${stock.symbol}">Show Chart</button>
      ${token ? `<button class="btn-add-watchlist" data-symbol="${stock.symbol}">+ Watchlist</button>` : ''}
  </li>`;
}

function attachChartButtons() {
  document.querySelectorAll(".btn-show-chart").forEach(btn => {
    btn.addEventListener("click", () => renderStockChart(btn.dataset.symbol));
  });
  document.querySelectorAll(".btn-add-watchlist").forEach(btn => {
    btn.addEventListener("click", async () => {
      const symbol = btn.dataset.symbol;
      try {
        const res = await fetch(`${base}/api/watchlist/dynamic`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({ symbol })
        });
        if (!res.ok) throw new Error("Failed to add watchlist");
        alert(`${symbol} added to watchlist`);
        loadWatchlist();
      } catch (err) {
        console.error(err);
        alert(err.message);
      }
    });
  });
}

// ---------------- Dashboard ----------------
async function loadDashboard() {
  try {
    const res = await fetch(`${base}/api/stocks/topworst`);
    const data = await res.json();
    document.getElementById("top-performers").innerHTML = data.top.map(createStockItem).join("");
    document.getElementById("worst-performers").innerHTML = data.worst.map(createStockItem).join("");
    attachChartButtons();
    if (!window.dashboardInterval) window.dashboardInterval = setInterval(loadDashboard, 60000);
  } catch (err) { console.error("Error loading dashboard:", err); }
}

// ---------------- Watchlist ----------------
async function loadWatchlist() {
  try {
    if (!token) return;
    const res = await fetch(`${base}/api/watchlist`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { if ([401,403].includes(res.status)) { localStorage.clear(); token=""; document.getElementById("watchlist").innerHTML=""; return; } }
    const data = await res.json().catch(() => []);
    const stocks = Array.isArray(data) ? data : [];
    document.getElementById("watchlist").innerHTML = stocks.map(createStockItem).join("");
    attachChartButtons();
  } catch (err) { console.error("Error loading watchlist:", err); }
}

// ---------------- Chart ----------------
async function renderStockChart(symbol) {
  try {
    const res = await fetch(`${base}/api/stocks/indicators/${symbol}`);
    if (!res.ok) throw new Error("Failed to fetch chart data");
    const data = await res.json();

    const history = data.history;
    const indicators = data.indicators;

    const labels = history.map(d => new Date(d.date));
    const closes = history.map(d => d.close);
    const candles = history.map(d => ({ x: d.date, o: d.open, h: d.high, l: d.low, c: d.close }));

    const sma = indicators.sma20 || [];
    const ema = indicators.ema20 || [];
    const bollU = indicators.bollinger20?.upper || [];
    const bollL = indicators.bollinger20?.lower || [];
    const rsi = indicators.rsi14 || [];
    const macd = indicators.macd?.macdLine || [];
    const macdSignal = indicators.macd?.signalLine || [];

    // Destroy old charts
    ['priceChart','rsiChart','macdChart'].forEach(id => { const inst = Chart.getChart(id); inst && inst.destroy(); });

    const canUseCandles = !!(window.CandlestickController) || !!Chart?.registry?.controllers?.get?.('candlestick');
    if (!canUseCandles) {
      console.warn('chartjs-chart-financial not available; falling back to line chart');
    }

    // Price chart (candlestick when available, else line of closes)
    const priceChartType = canUseCandles ? 'candlestick' : 'line';

    // Helper: numeric arrays -> compact [{x, y}] aligned with labels (skip invalid)
    const toXY = (vals) => {
      const points = [];
      for (let i = 0; i < labels.length && i < vals.length; i++) {
        const y = vals[i];
        if (y === null || y === undefined) continue;
        const yNum = Number(y);
        if (!Number.isFinite(yNum)) continue;
        points.push({ x: labels[i], y: yNum });
      }
      return points;
    };

    const priceDatasets = canUseCandles
      ? [
          { label: 'Candles', data: candles },
          { type: 'line', label: 'SMA', data: toXY(sma), borderColor: 'red', borderWidth: 1.5, pointRadius: 0 },
          { type: 'line', label: 'EMA', data: toXY(ema), borderColor: 'blue', borderWidth: 1.5, pointRadius: 0 },
          { type: 'line', label: 'Boll Upper', data: toXY(bollU), borderColor: 'orange', borderDash: [5, 5], pointRadius: 0 },
          { type: 'line', label: 'Boll Lower', data: toXY(bollL), borderColor: 'orange', borderDash: [5, 5], pointRadius: 0 }
        ]
      : [
          { label: 'Close', data: closes, borderColor: '#0d6efd', pointRadius: 0 },
          { label: 'SMA', data: sma, borderColor: 'red', borderWidth: 1.5, pointRadius: 0 },
          { label: 'EMA', data: ema, borderColor: 'blue', borderWidth: 1.5, pointRadius: 0 },
          { label: 'Boll Upper', data: bollU, borderColor: 'orange', borderDash: [5, 5], pointRadius: 0 },
          { label: 'Boll Lower', data: bollL, borderColor: 'orange', borderDash: [5, 5], pointRadius: 0 }
        ];

    new Chart(document.getElementById('priceChart'), {
      type: priceChartType,
      data: canUseCandles ? { datasets: priceDatasets } : { labels, datasets: priceDatasets },
      options: {
        scales: {
          x: { type: 'time' },
          y: { beginAtZero: false }
        }
      }
    });

    new Chart(document.getElementById('rsiChart'), {
      type:'line', data:{ labels, datasets:[{ label:'RSI', data:rsi, borderColor:'purple' }] },
      options:{ scales:{ y:{ min:0,max:100 } } }
    });

    new Chart(document.getElementById('macdChart'), {
      type:'line', data:{ labels, datasets:[
        { label:'MACD', data:macd, borderColor:'green' },
        { label:'Signal', data:macdSignal, borderColor:'gray', borderDash:[4,4] }
      ]}
    });

  } catch (err) { console.error("Chart error:", err); }
}

// ---------------- Init ----------------
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btn_logout")?.addEventListener("click", () => { localStorage.clear(); window.location.href="login.html"; });
  loadDashboard();
  loadWatchlist();
});
