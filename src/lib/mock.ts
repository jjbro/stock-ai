import type { CandlestickData } from "lightweight-charts";

export type Timeframe = "1D" | "1W" | "1M" | "1Y";

const baseCandles: Record<Timeframe, CandlestickData[]> = {
  "1D": [
    { time: "2025-12-29", open: 102, high: 106, low: 100, close: 105 },
    { time: "2025-12-30", open: 105, high: 109, low: 103, close: 108 },
    { time: "2026-01-02", open: 108, high: 112, low: 107, close: 111 },
    { time: "2026-01-03", open: 111, high: 113, low: 109, close: 110 },
    { time: "2026-01-06", open: 110, high: 114, low: 108, close: 112 },
    { time: "2026-01-07", open: 112, high: 115, low: 111, close: 114 },
  ],
  "1W": [
    { time: "2025-11-29", open: 95, high: 104, low: 92, close: 102 },
    { time: "2025-12-06", open: 102, high: 110, low: 101, close: 108 },
    { time: "2025-12-13", open: 108, high: 112, low: 105, close: 106 },
    { time: "2025-12-20", open: 106, high: 111, low: 104, close: 109 },
    { time: "2025-12-27", open: 109, high: 115, low: 108, close: 114 },
  ],
  "1M": [
    { time: "2025-08-01", open: 80, high: 95, low: 78, close: 92 },
    { time: "2025-09-01", open: 92, high: 99, low: 90, close: 96 },
    { time: "2025-10-01", open: 96, high: 103, low: 94, close: 101 },
    { time: "2025-11-01", open: 101, high: 108, low: 98, close: 106 },
    { time: "2025-12-01", open: 106, high: 116, low: 103, close: 114 },
  ],
  "1Y": [
    { time: "2024-02-01", open: 60, high: 75, low: 58, close: 70 },
    { time: "2024-05-01", open: 70, high: 82, low: 68, close: 78 },
    { time: "2024-08-01", open: 78, high: 90, low: 76, close: 86 },
    { time: "2024-11-01", open: 86, high: 98, low: 84, close: 94 },
    { time: "2025-02-01", open: 94, high: 110, low: 92, close: 108 },
    { time: "2025-05-01", open: 108, high: 120, low: 104, close: 116 },
  ],
};

const symbolMultipliers: Record<string, number> = {
  샘플전자: 1,
  삼성전자: 1.08,
  하이테크: 1.2,
  클라우드랩: 0.85,
  "AAPL": 1.05,
  "TSLA": 1.3,
};

export const knownSymbols = Object.keys(symbolMultipliers);

function scaleCandles(
  candles: CandlestickData[],
  multiplier: number
): CandlestickData[] {
  return candles.map((candle) => ({
    ...candle,
    open: Math.round(candle.open * multiplier * 100) / 100,
    high: Math.round(candle.high * multiplier * 100) / 100,
    low: Math.round(candle.low * multiplier * 100) / 100,
    close: Math.round(candle.close * multiplier * 100) / 100,
  }));
}

export function getMockCandles(
  symbol: string,
  timeframe: Timeframe
): CandlestickData[] | null {
  const multiplier = symbolMultipliers[symbol];
  if (!multiplier) return null;
  return scaleCandles(baseCandles[timeframe], multiplier);
}

export type NewsSource = {
  title: string;
  url: string;
};

export const mockReport = {
  companyName: "종목명",
  revenue: {
    qoq: 0,
    yoy: 0,
  },
  revenueSeries: {
    currentYear: {
      year: 2025,
      points: [] as { label: string; value: number }[],
    },
    previousYear: {
      year: 2024,
      points: [] as { label: string; value: number }[],
    },
  },
  annualRevenue: [] as { year: number; value: number }[],
  price: {
    current: 0,
    change: 0,
    changePercent: 0,
    currency: "KRW",
  },
  news: {
    sentiment: "neutral" as const,
    score: 0.5,
    highlights: [] as string[],
  },
  summary: "데이터를 불러오는 중입니다...",
  narrative: "",
  technicalAnalysis: "",
  pros: [] as string[],
  cons: [] as string[],
  sources: [] as NewsSource[],
};
