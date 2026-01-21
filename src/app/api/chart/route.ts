import { NextResponse } from "next/server";
import type { CandlestickData } from "lightweight-charts";
import type { Timeframe } from "@/lib/mock";
import { getKrxSymbols } from "@/lib/krx";
import { fallbackSymbolDirectory } from "@/lib/symbols";
import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance();

const timeframeConfig: Record<
  Timeframe,
  { range: "3mo" | "1y" | "10y"; interval: any; resample?: "yearly"; maxPoints?: number }
> = {
  "1D": { range: "3mo", interval: "1d", maxPoints: 80 },
  "1W": { range: "1y", interval: "1wk", maxPoints: 120 },
  "1M": { range: "10y", interval: "1mo", maxPoints: 120 },
  "1Y": { range: "10y", interval: "1mo", resample: "yearly", maxPoints: 40 },
};

function getPeriod1(range: "3mo" | "1y" | "10y") {
  const date = new Date();
  if (range === "3mo") {
    date.setMonth(date.getMonth() - 3);
    return date;
  }
  if (range === "1y") {
    date.setFullYear(date.getFullYear() - 1);
    return date;
  }
  date.setFullYear(date.getFullYear() - 10);
  return date;
}

async function normalizeSymbol(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const symbols = await getKrxSymbols();
  const directory = symbols.length ? symbols : fallbackSymbolDirectory;
  const mapped = directory.find(
    (entry) => entry.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (mapped) {
    return [mapped.ticker];
  }
  const normalized = trimmed.toUpperCase();
  if (normalized.includes(".")) return [normalized];
  if (/^\d{6}$/.test(normalized)) {
    return [`${normalized}.KS`, `${normalized}.KQ`];
  }
  return [normalized];
}

function resampleYearly(data: CandlestickData[]) {
  const grouped = new Map<number, CandlestickData[]>();
  data.forEach((item) => {
    const year = new Date(Number(item.time) * 1000).getUTCFullYear();
    const bucket = grouped.get(year) ?? [];
    bucket.push(item);
    grouped.set(year, bucket);
  });

  const years = Array.from(grouped.keys()).sort((a, b) => a - b);
  return years.map((year) => {
    const items = grouped.get(year)!;
    const sorted = [...items].sort((a, b) => Number(a.time) - Number(b.time));
    const open = sorted[0].open;
    const close = sorted[sorted.length - 1].close;
    const high = Math.max(...sorted.map((i) => i.high));
    const low = Math.min(...sorted.map((i) => i.low));
    const time = sorted[0].time;
    return { time, open, high, low, close };
  });
}

function downsampleCandles(
  data: CandlestickData[],
  maxPoints?: number
) {
  if (!maxPoints || data.length <= maxPoints) return data;
  const step = Math.ceil(data.length / maxPoints);
  return data.filter((_, index) => index % step === 0);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawSymbol = searchParams.get("symbol") ?? "";
  const timeframe = (searchParams.get("timeframe") ?? "1D") as Timeframe;
  const config = timeframeConfig[timeframe] ?? timeframeConfig["1D"];
  const candidates = await normalizeSymbol(rawSymbol);

  if (!candidates.length) {
    return NextResponse.json(
      { ok: false, message: "종목을 입력해주세요." },
      { status: 404 }
    );
  }

  for (const symbol of candidates) {
    try {
      console.log(`[Chart API] Fetching ${symbol} via yahoo-finance2...`);
      const result = await yahooFinance.chart(symbol, {
        period1: getPeriod1(config.range),
        period2: new Date(),
        interval: config.interval,
        return: "array",
      });

      if (!result.quotes || result.quotes.length === 0) continue;

      let candles: CandlestickData[] = result.quotes
        .map((quote: any) => ({
          time: Math.floor(new Date(quote.date).getTime() / 1000),
          open: quote.open,
          high: quote.high,
          low: quote.low,
          close: quote.close,
        }))
        .filter((c: any) => c.open != null && c.close != null);

      if (config.resample === "yearly") {
        candles = resampleYearly(candles);
      }
      candles = downsampleCandles(candles, config.maxPoints);

      if (candles.length) {
        return NextResponse.json({
          ok: true,
          symbol,
          timeframe,
          candles,
        });
      }
    } catch (e) {
      console.error(`[Chart API Failed] ${symbol}:`, e);
      continue;
    }
  }

  return NextResponse.json(
    { ok: false, message: "종목을 찾을 수 없습니다." },
    { status: 404 }
  );
}
