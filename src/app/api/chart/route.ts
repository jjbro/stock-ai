import { NextResponse } from "next/server";
import type { CandlestickData, UTCTimestamp } from "lightweight-charts";
import type { Timeframe } from "@/lib/mock";
import { getKrxSymbols } from "@/lib/krx";
import { fallbackSymbolDirectory } from "@/lib/symbols";
import YahooFinance from 'yahoo-finance2';
import iconv from "iconv-lite";

const yahooFinance = new YahooFinance();
const otpUrl = "https://data.krx.co.kr/comm/fileDn/GenerateOTP/generate.cmd";
const downloadUrl =
  "https://data.krx.co.kr/comm/fileDn/download_csv/download.cmd";

const timeframeConfig: Record<
  Timeframe,
  { range: "3mo" | "1y" | "10y"; interval: any; resample?: "yearly"; maxPoints?: number }
> = {
  "1D": { range: "3mo", interval: "1d", maxPoints: 80 },
  "1W": { range: "1y", interval: "1wk", maxPoints: 120 },
  "1M": { range: "10y", interval: "1mo", maxPoints: 120 },
  "1Y": { range: "10y", interval: "1mo", resample: "yearly", maxPoints: 40 },
};

type KRXKLine = CandlestickData;

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

function toDateString(date: Date) {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function decodeCsvBuffer(buffer: Buffer) {
  return iconv.decode(buffer, "euc-kr");
}

function parseCsvRow(line: string) {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        current += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  result.push(current);
  return result;
}

async function requestKrxOtp(params: URLSearchParams) {
  const response = await fetch(otpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Referer: "https://data.krx.co.kr/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Origin: "https://data.krx.co.kr",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: params.toString(),
  });

  if (!response.ok) return null;
  const otp = (await response.text()).trim();
  const cookie = response.headers.get("set-cookie");
  return { otp: otp || null, cookie };
}

async function downloadKrxCsv(otp: string, cookie?: string | null) {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    Referer: "https://data.krx.co.kr/",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Origin: "https://data.krx.co.kr",
  };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(downloadUrl, {
    method: "POST",
    headers,
    body: new URLSearchParams({ code: otp }).toString(),
  });
  if (!response.ok) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) return null;
  return buffer;
}

function aggregateCandles(
  candles: KRXKLine[],
  period: "week" | "month" | "year"
) {
  if (!candles.length) return candles;
  const sorted = [...candles].sort((a, b) => Number(a.time) - Number(b.time));
  const groups = new Map<string, KRXKLine[]>();

  const toDate = (time: UTCTimestamp) => new Date(Number(time) * 1000);
  const getWeekKey = (date: Date) => {
    const day = date.getUTCDay();
    const diff = (day + 6) % 7; // Monday start
    const monday = new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() - diff
    ));
    return toDateString(monday);
  };

  sorted.forEach((candle) => {
    const date = toDate(candle.time as UTCTimestamp);
    let key = "";
    if (period === "week") {
      key = getWeekKey(date);
    } else if (period === "month") {
      key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    } else {
      key = String(date.getUTCFullYear());
    }
    const bucket = groups.get(key) ?? [];
    bucket.push(candle);
    groups.set(key, bucket);
  });

  return Array.from(groups.values()).map((items) => {
    const sortedItems = [...items].sort((a, b) => Number(a.time) - Number(b.time));
    const open = sortedItems[0].open;
    const close = sortedItems[sortedItems.length - 1].close;
    const high = Math.max(...sortedItems.map((i) => i.high));
    const low = Math.min(...sortedItems.map((i) => i.low));
    const time = sortedItems[0].time;
    return { time, open, high, low, close };
  });
}

async function fetchKrxDailyCandles(
  symbol: string,
  range: "3mo" | "1y" | "10y"
): Promise<KRXKLine[]> {
  const baseCode = symbol.split(".")[0];
  if (!/^\d{6}$/.test(baseCode)) return [];
  const start = getPeriod1(range);
  const end = new Date();
  const params = new URLSearchParams({
    locale: "ko_KR",
    trdDd: toDateString(end),
    strtDd: toDateString(start),
    endDd: toDateString(end),
    isuCd: baseCode,
    adjStkPrc: "2",
    csvxls_isNo: "csv",
    name: "fileDown",
    url: "dbms/MDC/STAT/standard/MDCSTAT01701",
  });

  const otpResult = await requestKrxOtp(params);
  if (!otpResult?.otp) return [];
  const buffer = await downloadKrxCsv(otpResult.otp, otpResult.cookie);
  if (!buffer) return [];
  const decoded = decodeCsvBuffer(buffer);
  const lines = decoded.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = parseCsvRow(lines[0]);
  const dateIdx = header.findIndex((value) => value.includes("일자"));
  const openIdx = header.findIndex((value) => value.includes("시가"));
  const highIdx = header.findIndex((value) => value.includes("고가"));
  const lowIdx = header.findIndex((value) => value.includes("저가"));
  const closeIdx = header.findIndex((value) => value.includes("종가"));
  if ([dateIdx, openIdx, highIdx, lowIdx, closeIdx].some((i) => i < 0)) {
    return [];
  }

  const candles = lines.slice(1).map((line) => {
    const row = parseCsvRow(line);
    const dateRaw = (row[dateIdx] || "").trim();
    const dateValue = Date.UTC(
      Number(dateRaw.slice(0, 4)),
      Number(dateRaw.slice(4, 6)) - 1,
      Number(dateRaw.slice(6, 8))
    );
    const open = Number((row[openIdx] || "0").replace(/,/g, ""));
    const high = Number((row[highIdx] || "0").replace(/,/g, ""));
    const low = Number((row[lowIdx] || "0").replace(/,/g, ""));
    const close = Number((row[closeIdx] || "0").replace(/,/g, ""));
    return {
      time: Math.floor(dateValue / 1000) as UTCTimestamp,
      open,
      high,
      low,
      close,
    };
  });

  return candles.filter((c) => c.open && c.close);
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
  const krxFirst =
    process.env.KRX_CHART_FIRST === "true" ||
    process.env.NODE_ENV !== "production";

  if (!candidates.length) {
    return NextResponse.json(
      { ok: false, message: "종목을 입력해주세요." },
      { status: 404 }
    );
  }

  for (const symbol of candidates) {
    if (krxFirst) {
      try {
        const daily = await fetchKrxDailyCandles(symbol, config.range);
        let candles = daily;
        if (timeframe === "1W") {
          candles = aggregateCandles(daily, "week");
        } else if (timeframe === "1M") {
          candles = aggregateCandles(daily, "month");
        } else if (timeframe === "1Y") {
          candles = aggregateCandles(daily, "year");
        }
        candles = downsampleCandles(candles, config.maxPoints);
        if (candles.length) {
          return NextResponse.json({
            ok: true,
            symbol,
            timeframe,
            candles,
            source: "krx",
          });
        }
      } catch (e) {
        console.warn(`[KRX Chart Failed] ${symbol}:`, e);
      }
    }
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
          time: Math.floor(
            new Date(quote.date).getTime() / 1000
          ) as UTCTimestamp,
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
      const message = e instanceof Error ? e.message : String(e);
      const isRateLimited =
        message.includes("429") || message.includes("Too Many Requests");
      if (isRateLimited) {
        return NextResponse.json(
          { ok: false, message: "차트 데이터 서버 점검 중입니다." },
          { status: 503 }
        );
      }
      console.error(`[Chart API Failed] ${symbol}:`, e);
      continue;
    }
  }

  return NextResponse.json(
    { ok: false, message: "종목을 찾을 수 없습니다." },
    { status: 404 }
  );
}
