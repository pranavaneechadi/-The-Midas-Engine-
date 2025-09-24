function sma(source, period) {
  const out = new Array(source.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < source.length; i++) {
    sum += source[i];
    if (i >= period) sum -= source[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(source, period) {
  const out = new Array(source.length).fill(null);
  if (period <= 0 || source.length === 0) return out;
  const k = 2 / (period + 1);
  let prev;
  if (source.length >= period) {
    let sum = 0;
    for (let i = 0; i < period; i++) sum += source[i];
    prev = sum / period;
    out[period - 1] = prev;
    for (let i = period; i < source.length; i++) {
      prev = source[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  } else {
    prev = source[0];
    out[0] = prev;
    for (let i = 1; i < source.length; i++) {
      prev = source[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

function rsi(source, period = 14) {
  const out = new Array(source.length).fill(null);
  if (period <= 0 || source.length <= period) return out;

  const gains = [];
  const losses = [];
  for (let i = 1; i < source.length; i++) {
    const diff = source[i] - source[i - 1];
    gains.push(Math.max(0, diff));
    losses.push(Math.max(0, -diff));
  }

  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < period; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }
  avgGain /= period;
  avgLoss /= period;

  let rs = avgGain / (avgLoss === 0 ? 1e-10 : avgLoss);
  out[period] = 100 - (100 / (1 + rs));

  for (let i = period + 1; i < source.length; i++) {
    const g = gains[i - 1];
    const l = losses[i - 1];
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    rs = avgGain / (avgLoss === 0 ? 1e-10 : avgLoss);
    out[i] = 100 - (100 / (1 + rs));
  }
  return out;
}

function macd(source, fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(source, fast);
  const emaSlow = ema(source, slow);
  const macdLine = new Array(source.length).fill(null);
  for (let i = 0; i < source.length; i++) {
    const a = emaFast[i], b = emaSlow[i];
    macdLine[i] = (a === null || b === null) ? null : a - b;
  }
  const macdNumeric = macdLine.map(v => (v === null ? 0 : v));
  const signalLine = ema(macdNumeric, signal).map((v, i) => (macdLine[i] === null ? null : v));
  const histogram = macdLine.map((v, i) => (v === null || signalLine[i] === null ? null : v - signalLine[i]));
  return { macdLine, signalLine, histogram };
}

function bollingerBands(source, period = 20, multiplier = 2) {
  const smaArr = sma(source, period);
  const upper = new Array(source.length).fill(null);
  const lower = new Array(source.length).fill(null);
  for (let i = period - 1; i < source.length; i++) {
    let sum = 0;
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += source[j];
      sumSq += source[j] * source[j];
    }
    const mean = sum / period;
    const variance = (sumSq / period) - (mean * mean);
    const sd = Math.sqrt(Math.max(0, variance));
    upper[i] = mean + multiplier * sd;
    lower[i] = mean - multiplier * sd;
  }
  return { upper, middle: smaArr, lower };
}

function calcAllIndicators(closes) {
  return {
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    ema20: ema(closes, 20),
    ema50: ema(closes, 50),
    rsi14: rsi(closes, 14),
    macd: macd(closes, 12, 26, 9),
    bollinger20: bollingerBands(closes, 20, 2)
  };
}

module.exports = { sma, ema, rsi, macd, bollingerBands, calcAllIndicators };
