// backend/server.js
require('dotenv').config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const path = require("path");
const axios = require("axios");
const cron = require("node-cron");
const User = require("./models/user");
const { calcAllIndicators } = require("./utils/indicators");

const app = express();
const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const ALPHA_VANTAGE_KEY = process.env.ALPHA_VANTAGE_KEY;

if (!JWT_SECRET) throw new Error("JWT_SECRET not set in .env!");
if (!ALPHA_VANTAGE_KEY) throw new Error("ALPHA_VANTAGE_KEY not set in .env!");

// ---------- Simple in-memory cache ----------
const cache = new Map();
function setCache(key, value, ttlMs = 60_000) {
  cache.set(key, { ts: Date.now(), ttl: ttlMs, value });
}
function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > entry.ttl) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

// ---------- Middleware ----------
app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ---------- Frontend routes ----------
app.get('/', (req, res) => res.redirect('/login'));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '../frontend/login.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, '../frontend/signup.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));
app.get('/trade', (req, res) => res.sendFile(path.join(__dirname, '../frontend/tradingview.html')));

// ---------- DB Connect ----------
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("MongoDB connection error:", err));

// ---------- Auth middleware ----------
function auth(req, res, next) {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.status(401).json({ msg: "No token" });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ msg: "Invalid token" });
    req.user = user;
    next();
  });
}

// ---------- AUTH routes ----------
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).send("Missing username/password");

    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).send("Username already exists");

    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashed });
    await user.save();

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "2h" });
    res.json({ message: "User registered", token });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(400).send("Signup failed: " + err.message);
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ msg: "Missing fields" });

    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ msg: "User not found" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ msg: "Wrong password" });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "2h" });
    res.json({ token, username: user.username });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ msg: "Server error during login" });
  }
});

// ---------- WATCHLIST routes ----------
app.get("/api/watchlist", auth, async (req, res) => {
  const user = await User.findById(req.user.id);
  res.json(user?.watchlist || []);
});

app.post("/api/watchlist", auth, async (req, res) => {
  const { symbol } = req.body;
  if (!symbol) return res.status(400).send("Missing symbol");

  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).send("User not found");

  if (!user.watchlist.some(s => s.symbol === symbol)) {
    user.watchlist.push({ symbol });
    await user.save();
  }
  res.send("Stock added to watchlist");
});

app.delete("/api/watchlist/:symbol", auth, async (req, res) => {
  const { symbol } = req.params;
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).send("User not found");

  user.watchlist = user.watchlist.filter(s => s.symbol !== symbol);
  await user.save();
  res.send("Removed from watchlist");
});

// ---------- DYNAMIC watchlist route ----------
app.post("/api/watchlist/dynamic", auth, async (req, res) => {
  try {
    const { symbol } = req.body;
    if (!symbol) return res.status(400).json({ error: "Missing symbol" });

    // Validate symbol exists via Alpha Vantage
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${ALPHA_VANTAGE_KEY}`;
    const response = await axios.get(url);
    const quote = response.data['Global Quote'];
    if (!quote || !quote['01. symbol']) return res.status(404).json({ error: "Invalid symbol" });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const symUpper = symbol.toUpperCase();
    if (!user.watchlist.some(s => s.symbol === symUpper)) {
      user.watchlist.push({ symbol: symUpper });
      await user.save();
    }

    res.json({ message: `${symUpper} added to watchlist`, watchlist: user.watchlist });
  } catch (err) {
    console.error("Add dynamic watchlist error:", err);
    res.status(500).json({ error: "Failed to add stock to watchlist" });
  }
});

// ---------- STOCKS / TOP & WORST ----------
const STOCKS_TO_TRACK = [
  'RELIANCE.BSE', 'TCS.BSE', 'HDFCBANK.BSE', 'INFY.BSE',
  'ICICIBANK.BSE', 'ITC.BSE', 'HINDUNILVR.BSE', 'SBIN.BSE',
  'BHARTIARTL.BSE', 'KOTAKBANK.BSE', 'AAPL', 'MSFT', 'GOOGL'
];

async function safeQuoteAlpha(symbol) {
  try {
    const cacheKey = `quote:${symbol}`;
    const cached = getCache(cacheKey);
    if (cached) return cached;

    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${ALPHA_VANTAGE_KEY}`;
    const response = await axios.get(url);
    const quote = response.data['Global Quote'];
    if (!quote) return null;

    const price = parseFloat(quote['05. price'] || 0);
    const changeRaw = parseFloat(quote['10. change percent']?.replace('%','') || 0);

    const result = {
      symbol,
      price,
      change: changeRaw.toFixed(2) + '%',
      changeRaw,
      volume: parseInt(quote['06. volume'] || 0),
      dayHigh: parseFloat(quote['03. high'] || 0),
      dayLow: parseFloat(quote['04. low'] || 0)
    };

    setCache(cacheKey, result, 60_000); // cache 1 min
    return result;
  } catch (err) {
    console.error(`Alpha Vantage quote error for ${symbol}:`, err.message || err);
    return null;
  }
}

app.get("/api/stocks/topworst", async (req, res) => {
  try {
    const cacheKey = 'topworst';
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    // Limit symbols per request to avoid rate limiting
    const symbols = STOCKS_TO_TRACK.slice(0, 6);
    const quotes = await Promise.all(symbols.map(s => safeQuoteAlpha(s)));
    const valid = quotes.filter(q => q !== null);
    const sorted = valid.sort((a, b) => b.changeRaw - a.changeRaw);

    let payload;
    if (sorted.length === 0) {
      // Fallback demo data when API is rate-limited or key missing
      payload = {
        top: [
          { symbol: 'AAPL', price: 190.12, change: '1.25%', changeRaw: 1.25, volume: 120000000, dayHigh: 191.3, dayLow: 188.9 },
          { symbol: 'MSFT', price: 420.55, change: '0.84%', changeRaw: 0.84, volume: 80000000, dayHigh: 421.1, dayLow: 417.4 },
          { symbol: 'GOOGL', price: 150.75, change: '0.62%', changeRaw: 0.62, volume: 60000000, dayHigh: 151.2, dayLow: 149.9 }
        ],
        worst: [
          { symbol: 'INFY.BSE', price: 1550.3, change: '-0.55%', changeRaw: -0.55, volume: 4500000, dayHigh: 1561.0, dayLow: 1548.0 },
          { symbol: 'TCS.BSE', price: 3950.1, change: '-0.72%', changeRaw: -0.72, volume: 3200000, dayHigh: 3980.0, dayLow: 3940.0 },
          { symbol: 'SBIN.BSE', price: 785.4, change: '-1.15%', changeRaw: -1.15, volume: 9000000, dayHigh: 795.0, dayLow: 782.0 }
        ]
      };
    } else {
      payload = {
        top: sorted.slice(0, 5),
        worst: sorted.slice(-5).reverse()
      };
    }
    setCache(cacheKey, payload, 60_000); // 1 min cache

    res.json(payload);
  } catch (err) {
    console.error("Top/Worst fetch error:", err);
    // Return fallback on error as well
    res.json({
      
      top: [
        { symbol: 'AAPL', price: 190.12, change: '1.25%', changeRaw: 1.25, volume: 120000000, dayHigh: 191.3, dayLow: 188.9 }
      ],
      worst: [
        { symbol: 'SBIN.BSE', price: 785.4, change: '-1.15%', changeRaw: -1.15, volume: 9000000, dayHigh: 795.0, dayLow: 782.0 }
      ]
    });
  }
});

// ---------- HISTORY + INDICATORS ----------
app.get("/api/stocks/indicators/:symbol", async (req, res) => {
  try {
    const { symbol } = req.params;
    if (!symbol) return res.status(400).json({ error: "Missing symbol" });

    const cacheKey = `indicators:${symbol}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    // Fetch historical daily data (last 100 days)
    const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=compact&apikey=${ALPHA_VANTAGE_KEY}`;
    const response = await axios.get(url);
    const data = response.data['Time Series (Daily)'];
    if (!data) {
      // Fallback synthetic history if API is unavailable
      const today = new Date();
      const history = Array.from({ length: 60 }).map((_, idx) => {
        const d = new Date(today);
        d.setDate(d.getDate() - (60 - idx));
        const base = 100 + idx * 0.3;
        const volatility = 2 + (idx % 5);
        const close = base + Math.sin(idx / 4) * volatility;
        return {
          date: d.toISOString().slice(0, 10),
          open: close - 0.5,
          high: close + 1.2,
          low: close - 1.4,
          close: close,
          volume: 1000000 + idx * 1000
        };
      });
      const closes = history.map(d => d.close);
      const indicators = calcAllIndicators(closes);
      return res.json({ symbol, history, indicators });
    }

    const formatted = Object.keys(data)
      .map(date => ({
        date,
        open: parseFloat(data[date]['1. open']),
        high: parseFloat(data[date]['2. high']),
        low: parseFloat(data[date]['3. low']),
        close: parseFloat(data[date]['4. close']),
        volume: parseInt(data[date]['5. volume'])
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    const closes = formatted.map(d => d.close);
    const indicators = calcAllIndicators(closes);

    const resp = { symbol, history: formatted, indicators };
    setCache(cacheKey, resp, 60_000); // cache 1 min

    res.json(resp);
  } catch (err) {
    console.error("Indicators fetch error:", err);
    // Fallback on error
    try {
      const today = new Date();
      const history = Array.from({ length: 60 }).map((_, idx) => {
        const d = new Date(today);
        d.setDate(d.getDate() - (60 - idx));
        const base = 120 + idx * 0.25;
        const volatility = 1.8 + (idx % 7) * 0.3;
        const close = base + Math.cos(idx / 5) * volatility;
        return {
          date: d.toISOString().slice(0, 10),
          open: close - 0.6,
          high: close + 1.1,
          low: close - 1.2,
          close: close,
          volume: 1200000 + idx * 800
        };
      });
      const closes = history.map(d => d.close);
      const indicators = calcAllIndicators(closes);
      res.json({ symbol: req.params.symbol, history, indicators });
    } catch (e) {
      res.status(500).json({ error: "Failed to compute fallback indicators" });
    }
  }
});

// ---------- SEARCH stock ----------
app.get("/api/stocks/search/:symbol", async (req, res) => {
  try {
    const { symbol } = req.params;
    if (!symbol) return res.status(400).json({ error: "Missing symbol" });

    const cacheKey = `quote:${symbol.toUpperCase()}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${ALPHA_VANTAGE_KEY}`;
    const response = await axios.get(url);
    const quote = response.data['Global Quote'];
    if (!quote || !quote['01. symbol']) return res.status(404).json({ error: "Symbol not found" });

    const result = {
      symbol: quote['01. symbol'],
      price: parseFloat(quote['05. price'] || 0),
      change: parseFloat(quote['10. change percent']?.replace('%','') || 0).toFixed(2) + '%',
      changeRaw: parseFloat(quote['10. change percent']?.replace('%','') || 0),
      volume: parseInt(quote['06. volume'] || 0),
      dayHigh: parseFloat(quote['03. high'] || 0),
      dayLow: parseFloat(quote['04. low'] || 0)
    };

    setCache(cacheKey, result, 60_000); // 1 min cache
    res.json(result);

  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Failed to fetch stock data" });
  }
});

// ---------- Catch-all ----------
app.use((req, res) => res.status(404).json({ error: "Not found" }));

// ---------- Start server ----------
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
