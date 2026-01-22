import { getKrxSymbols } from "./krx";
import { fallbackSymbolDirectory, cleanStockName } from "./symbols";
import { mockReport } from "./mock";
import { getMarketSignal } from "./reporting";
import YahooFinance from "yahoo-finance2";
import fs from "fs";
import path from "path";

const yahooFinance = new YahooFinance();

export type Sentiment = "positive" | "negative" | "neutral";

export type NewsItem = {
  title: string;
  url: string;
  publishedAt?: string;
};

export type OpenAIReport = {
  summary: string;
  narrative: string;
  technicalAnalysis: string;
  pros: string[];
  cons: string[];
  sentiment: Sentiment;
  sentimentScore: number;
};

const newsLimit = 6;

// Server-side cache for getFullReport to avoid redundant AI calls and Yahoo Finance hits
const REPORT_CACHE_KEY = "__full_report_cache__";

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => resolve(fallback), ms);
  });
  const result = await Promise.race([promise, timeoutPromise]);
  if (timeoutId) clearTimeout(timeoutId);
  return result;
}

function getNextExpiry() {
  const now = new Date();
  const kstOffset = 9 * 60; // KST is UTC+9
  const nowKst = new Date(now.getTime() + (kstOffset + now.getTimezoneOffset()) * 60000);
  
  const expiry = new Date(nowKst);
  expiry.setHours(17, 0, 0, 0); // Today 5 PM KST

  // If it's already past 5 PM KST, set expiry to tomorrow 5 PM KST
  if (nowKst >= expiry) {
    expiry.setDate(expiry.getDate() + 1);
  }
  
  // Convert back to UTC time for the actual comparison
  return now.getTime() + (expiry.getTime() - nowKst.getTime());
}

function getGlobalReportCache(): Map<string, { expiresAt: number; data: any }> {
  const globalAny = globalThis as any;
  if (!globalAny[REPORT_CACHE_KEY]) {
    globalAny[REPORT_CACHE_KEY] = new Map();
  }
  return globalAny[REPORT_CACHE_KEY];
}





// 로컬 JSON 파일에서 매출액 데이터 로드
let revenueDataCache: Record<string, any> | null = null;

function loadRevenueData(): Record<string, any> | null {
  if (revenueDataCache) return revenueDataCache;
  
  try {
    const dataPath = path.join(process.cwd(), "data", "revenue-data.json");
    const fileContent = fs.readFileSync(dataPath, "utf8");
    revenueDataCache = JSON.parse(fileContent);
    return revenueDataCache;
  } catch (error) {
    console.warn("[Revenue Data] Failed to load revenue-data.json:", error);
    return null;
  }
}

// JSON 파일에서 매출액 조회
function getRevenueFromJson(corpCode: string, year: number, quarter: "Q1" | "Q2" | "Q3" | "Q4" | "H1" | "FY"): number | null {
  const data = loadRevenueData();
  if (!data || !data[corpCode]) return null;
  
  const yearData = data[corpCode].revenue?.[String(year)];
  if (!yearData) return null;
  
  const value = yearData[quarter];
  return value !== null && value !== undefined ? value : null;
}



function normalizeSymbol(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.includes(".")) return trimmed.toUpperCase();
  if (/^\d{6}$/.test(trimmed)) return `${trimmed}.KS`;
  return trimmed;
}

function computeChange(current?: number, prev?: number) {
  if (!current || !prev) return 0;
  return (current - prev) / prev;
}

function buildPriceFromQuote(
  quote: any | null,
  chartData: { close?: number }[]
) {
  const fallbackLast = chartData[chartData.length - 1]?.close;
  const fallbackPrev = chartData[chartData.length - 2]?.close;
  const quotePrice =
    quote?.regularMarketPrice ??
    quote?.postMarketPrice ??
    quote?.preMarketPrice ??
    quote?.regularMarketPreviousClose ??
    null;

  if (quotePrice) {
    return {
      current: quotePrice,
      change:
        quote?.regularMarketChange ??
        (fallbackPrev != null ? quotePrice - fallbackPrev : 0),
      changePercent:
        quote?.regularMarketChangePercent ??
        (fallbackPrev ? (quotePrice - fallbackPrev) / fallbackPrev : 0),
      currency: quote?.currency ?? "KRW",
    };
  }

  if (fallbackLast) {
    return {
      current: fallbackLast,
      change: fallbackPrev != null ? fallbackLast - fallbackPrev : 0,
      changePercent: fallbackPrev ? (fallbackLast - fallbackPrev) / fallbackPrev : 0,
      currency: "KRW",
    };
  }

  return null;
}

function buildRevenueSeries(revenues: { date: number; revenue: number }[]) {
  const grouped = new Map<number, Map<number, number>>();
  revenues.forEach((item) => {
    const date = new Date(item.date * 1000);
    const year = date.getUTCFullYear();
    const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
    if (!grouped.has(year)) grouped.set(year, new Map());
    grouped.get(year)!.set(quarter, item.revenue);
  });

  const years = Array.from(grouped.keys()).sort((a, b) => b - a);
  const currentYear = years[0];
  const previousYear = years[1];
  if (!currentYear) return null;

  const toPoints = (year: number) => {
    const map = grouped.get(year) ?? new Map();
    return ["Q1", "Q2", "Q3", "Q4"].map((label, index) => ({
      label,
      value: map.get(index + 1) ?? 0,
    }));
  };

  const fallbackPreviousYear = previousYear ?? currentYear - 1;
  return {
    currentYear: { year: currentYear, points: toPoints(currentYear) },
    previousYear: { year: fallbackPreviousYear, points: toPoints(fallbackPreviousYear) },
  };
}

function buildAnnualRevenue(
  revenues: { date: number; revenue: number }[],
  maxYears = 5
) {
  const totals = new Map<number, number>();
  revenues.forEach((item) => {
    const date = new Date(item.date * 1000);
    const year = date.getUTCFullYear();
    totals.set(year, (totals.get(year) ?? 0) + item.revenue);
  });
  return Array.from(totals.entries())
    .map(([year, value]) => ({ year, value }))
    .sort((a, b) => a.year - b.year)
    .slice(-maxYears);
}

export async function resolveCompany(raw: string) {
  const symbols = await getKrxSymbols();
  const directory = symbols.length ? symbols : fallbackSymbolDirectory;
  
  // 만약 005930.KS 형식으로 들어오면 005930만 추출하여 검색
  const searchTarget = raw.includes(".") ? raw.split(".")[0] : raw;
  const normalized = cleanStockName(searchTarget).toLowerCase();

  const mapped = directory.find((entry) => {
    const entryName = cleanStockName(entry.name).toLowerCase();
    const entryTickerBase = entry.ticker.split(".")[0];
    return (
      entryName === normalized ||
      entryTickerBase === normalized ||
      entry.searchNames?.some((alias) => alias.toLowerCase() === normalized)
    );
  });

  if (mapped) {
    return { ticker: mapped.ticker, name: mapped.name };
  }

  const ticker = normalizeSymbol(raw) ?? raw;
  return { ticker, name: raw };
}

async function fetchNews(companyName: string): Promise<NewsItem[]> {
  const query = encodeURIComponent(`${companyName} 주식 실적`);
  const url = `https://news.google.com/rss/search?q=${query}&hl=ko&gl=KR&ceid=KR:ko`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return [];
  const xml = await response.text();
  const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g));
  const news: NewsItem[] = [];
  for (const [, block] of items.slice(0, newsLimit)) {
    const title =
      block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] ??
      block.match(/<title>(.*?)<\/title>/)?.[1];
    const link = block.match(/<link>(.*?)<\/link>/)?.[1];
    const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1];
    if (title && link) {
      news.push({ title, url: link, publishedAt: pubDate });
    }
  }
  return news;
}

async function fetchQuarterlyRevenue(ticker: string, _companyName: string) {
  const cache = getGlobalReportCache();
  const cacheKey = `raw-revenue:${ticker}`;
  const cached = cache.get(cacheKey);
  
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const stockCode = ticker.split(".")[0];
  if (!/^\d{6}$/.test(stockCode)) return [];

  const now = new Date();
  const years = [now.getFullYear(), now.getFullYear() - 1];
  const results: { date: number; revenue: number }[] = [];

  for (const year of years) {
    const q1 = getRevenueFromJson(stockCode, year, "Q1");
    const q2 = getRevenueFromJson(stockCode, year, "Q2");
    const q3 = getRevenueFromJson(stockCode, year, "Q3");
    const q4 = getRevenueFromJson(stockCode, year, "Q4");

    const toDate = (month: number, day: number) =>
      Math.floor(Date.UTC(year, month - 1, day) / 1000);

    if (q1) results.push({ date: toDate(3, 31), revenue: q1 / 100000000 });
    if (q2) results.push({ date: toDate(6, 30), revenue: q2 / 100000000 });
    if (q3) results.push({ date: toDate(9, 30), revenue: q3 / 100000000 });
    if (q4) results.push({ date: toDate(12, 31), revenue: q4 / 100000000 });
  }

  if (results.length > 0) {
    cache.set(cacheKey, { expiresAt: getNextExpiry(), data: results });
  }

  return results
    .filter((item) => item.date && item.revenue)
    .sort((a, b) => b.date - a.date)
    .slice(0, 4);
}

function getChartPeriod1(range: "3mo" | "1y" | "10y") {
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

async function fetchRecentChart(ticker: string) {
  try {
    console.log(`[Chart] Fetching via yahoo-finance2 for ${ticker}...`);
    const result: any = await yahooFinance.chart(ticker, {
      period1: getChartPeriod1("3mo"),
      period2: new Date(),
      interval: "1d",
      return: "array",
    });

    if (!result.quotes || result.quotes.length === 0) return [];

    return result.quotes
      .map((quote: any) => ({
        date: new Date(quote.date).toISOString().split("T")[0],
        open: quote.open,
        high: quote.high,
        low: quote.low,
        close: quote.close,
      }))
      .filter((c: any) => c.open != null && c.close != null)
      .slice(-30);
  } catch (e) {
    console.warn(`[Chart API Failed] ${ticker} via yahoo-finance2:`, e);
    return [];
  }
}

async function callGemini(
  params: {
    companyName: string;
    qoq: number;
    yoy: number;
    news: NewsItem[];
    chartData: any[];
  },
  modelName: string,
  retryCount = 1,
  timeoutMs = 6000
) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY가 없습니다.");

  const prompt = `너는 주식 애널리스트이자 기술적 차트 전문가다. 한국어로 간결하고 명확하게 답한다.
아래 정보를 기반으로 JSON만 출력해줘.

회사: ${params.companyName}
전분기 매출 변화율: ${params.qoq.toFixed(3)}
전년 대비 매출 변화율: ${params.yoy.toFixed(3)}

최근 뉴스:
${
  params.news.length > 0
    ? params.news.map((item) => `- ${item.title}`).join("\n")
    : "최근 뉴스 없음"
}

최근 주가 데이터(OHLC):
${
  params.chartData.length > 0
    ? params.chartData
        .map(
          (c) =>
            `- ${c.date}: 시가:${c.open}, 고가:${c.high}, 저가:${c.low}, 종가:${c.close}`
        )
        .join("\n")
    : "주가 데이터 없음 (기술적 분석 불가)"
}

분석 요청:
1. 매출 흐름과 뉴스 감성 요약 (summary, narrative)
2. 기술적 분석: 위 제공된 '최근 주가 데이터(OHLC)'를 바탕으로 마지막 캔들의 모양(망치형, 도지형 등)을 반드시 포함하고, 최근 차트 패턴(W 바닥, 상승 다이버전스, 역헤드앤숄더, 엘리어트 파동 단계 등)을 간단히 언급. technicalAnalysis는 2~3줄로 짧게 작성하고 줄바꿈(\\n)을 넣어라. 데이터가 없다면 그 사유를 간단히 1줄로 작성.
3. 장점(pros)과 단점(cons) 각각 3개씩
4. 종합 감성(sentiment) 및 점수(sentimentScore) 0~1

출력 형식(JSON):
{
  "summary": "...",
  "narrative": "...",
  "technicalAnalysis": "마지막 봉은 ...이며, 최근 흐름은 ...",
  "pros": ["...", "...", "..."],
  "cons": ["...", "...", "..."],
  "sentiment": "positive|neutral|negative",
  "sentimentScore": 0.85
}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${url}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.3,
          responseMimeType: "application/json",
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error(`Gemini API 오류 (429): ${modelName} 사용량 초과`);
      }
      if (response.status === 404) {
        throw new Error(`Gemini API 오류 (404): ${modelName} 모델을 찾을 수 없음`);
      }
      if (response.status >= 500 && retryCount > 0) {
        return callGemini(params, modelName, retryCount - 1);
      }
      throw new Error(`Gemini API 오류 (${response.status}) - ${modelName}`);
    }

    const json = await response.json();
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!text) {
      throw new Error("Gemini 응답이 비어 있습니다.");
    }

    try {
      const firstBrace = text.indexOf("{");
      const lastBrace = text.lastIndexOf("}");
      if (firstBrace === -1 || lastBrace === -1) {
        throw new Error("JSON 형식을 찾을 수 없습니다.");
      }
      const jsonStr = text.substring(firstBrace, lastBrace + 1);
      return JSON.parse(jsonStr) as OpenAIReport;
    } catch (e) {
      console.error("Gemini JSON Parsing failed. Raw text:", text);
      throw new Error("AI 응답 해석에 실패했습니다.");
    }
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error(`Gemini API 오류 (timeout): ${modelName} 응답 시간 초과`);
    }
    if (retryCount > 0 && !error.message.includes("429") && !error.message.includes("404")) {
      return callGemini(params, modelName, retryCount - 1, timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getFullReport(rawSymbol: string) {
  const cache = getGlobalReportCache();
  const resolved = await resolveCompany(rawSymbol);
  const companyName = resolved.name || rawSymbol;
  const ticker = resolved.ticker || rawSymbol;
  console.log(`[Report] Requested: ${rawSymbol} -> ${ticker} (${companyName})`);

  const revenueCacheKey = `revenue-data:${ticker}`;
  const newsCacheKey = `news-data:${ticker}`;
  const aiCacheKey = `ai-report:${ticker}`;
  const expiry = getNextExpiry();
  const newsExpiry = Date.now() + 5 * 60 * 1000; // 5분 캐시

  // 1. 매출/가격 데이터(차트 포함) 가져오기 (캐시 우선)
  let marketData = cache.get(revenueCacheKey)?.data;
  if (!marketData || cache.get(revenueCacheKey)!.expiresAt < Date.now()) {
    console.log(`[Market Data] Fetching fresh chart/revenue for ${ticker}...`);
    const [revenues, chartData, quote] = (await Promise.all([
      fetchQuarterlyRevenue(ticker, companyName),
      withTimeout(fetchRecentChart(ticker), 2000, []),
      withTimeout(
        yahooFinance.quote(ticker).catch((e) => {
          console.warn(`[Quote API Failed] ${ticker}:`, e);
          return null;
        }),
        2000,
        null
      ),
    ])) as [any[], any[], any];

    const price = buildPriceFromQuote(quote, chartData);

    marketData = {
      revenues,
      chartData,
      price,
    };
    
    // 매출 데이터가 정상적일 때만 시장 데이터 캐싱
    if (revenues.length > 0) {
      cache.set(revenueCacheKey, { expiresAt: expiry, data: marketData });
    }
  } else {
    console.log(`[Market Data] Cache Hit for ${ticker}`);
  }

  if (!marketData?.price) {
    const quote = await yahooFinance.quote(ticker).catch((e) => {
      console.warn(`[Quote API Failed] ${ticker}:`, e);
      return null;
    });
    const refreshedPrice = buildPriceFromQuote(quote, marketData?.chartData ?? []);
    if (refreshedPrice) {
      marketData = { ...marketData, price: refreshedPrice };
      cache.set(revenueCacheKey, { expiresAt: expiry, data: marketData });
    }
  }

  // 2. 뉴스 데이터 가져오기 (5분 캐시)
  let newsData = cache.get(newsCacheKey)?.data;
  if (!newsData || cache.get(newsCacheKey)!.expiresAt < Date.now()) {
    console.log(`[News Data] Fetching fresh news for ${companyName}...`);
    newsData = await withTimeout(fetchNews(companyName), 1500, []);
    if (newsData.length > 0) {
      cache.set(newsCacheKey, { expiresAt: newsExpiry, data: newsData });
    }
  } else {
    console.log(`[News Data] Cache Hit for ${ticker} (5m cache)`);
  }

  const { revenues, chartData, price } = marketData;
  const news = newsData;

  const latest = revenues[0]?.revenue ?? 0;
  const prev = revenues[1]?.revenue ?? 0;
  const yearAgo = revenues[4]?.revenue ?? 0;
  const qoq = computeChange(latest, prev);
  const yoy = computeChange(latest, yearAgo);

  // 2. AI 리포트 가져오기 (캐시 우선)
  let aiReport = cache.get(aiCacheKey)?.data as OpenAIReport | null;
  let errorReason: string | null = null;

  const aiCacheEntry = cache.get(aiCacheKey);
  if (!aiReport || aiCacheEntry!.expiresAt < Date.now()) {
    console.log(
      `[AI Report] Cache Miss/Expired for ${ticker} (expiresAt=${aiCacheEntry?.expiresAt ?? "none"})`
    );
    const fallbackModels = [
      "gemini-2.5-flash",
      "gemini-2.5-flash-light",
      "gemini-3-flash-preview",
      "gemini-3-flash"
    ];

    for (const modelName of fallbackModels) {
      try {
        console.log(`[AI Attempt] Trying ${modelName} for ${companyName}...`);
        aiReport = await callGemini({
          companyName,
          qoq,
          yoy,
          news,
          chartData,
        }, modelName, 1, 6000);
        
        if (aiReport) {
          console.log(`[AI Success] ${modelName} worked for ${companyName}`);
          cache.set(aiCacheKey, { expiresAt: expiry, data: aiReport });
          errorReason = null;
          break;
        }
      } catch (e: any) {
        console.warn(`[AI Failed] ${modelName}: ${e.message}`);
        errorReason = e.message;
        if (e.message.includes("timeout")) break;
        if (e.message.includes("429") || e.message.includes("404")) continue;
        break;
      }
    }
  } else {
    console.log(
      `[AI Report] Cache Hit for ${ticker} (expiresAt=${aiCacheEntry?.expiresAt})`
    );
  }

  const revenueSeries = buildRevenueSeries(revenues);
  const annualRevenue = buildAnnualRevenue(revenues);

  const report = {
    ...mockReport,
    companyName,
    revenue: { 
      qoq: computeChange(revenues[0]?.revenue, revenues[1]?.revenue), 
      yoy: computeChange(revenues[0]?.revenue, revenues[4]?.revenue) 
    },
    revenueSeries: revenueSeries ?? mockReport.revenueSeries,
    annualRevenue: annualRevenue.length
      ? annualRevenue
      : mockReport.annualRevenue,
    price: price ?? null,
    news: {
      sentiment: aiReport?.sentiment ?? ("neutral" as Sentiment),
      score: aiReport?.sentimentScore ?? 0.5,
      highlights: news.slice(0, 3).map((item: any) => item.title),
    },
    summary: aiReport?.summary ?? "",
    narrative: aiReport?.narrative ?? "",
    technicalAnalysis:
      aiReport?.technicalAnalysis ??
      (errorReason?.includes("429") ? "AI 사용량 초과입니다." : "데이터가 부족하여 기술적 분석을 제공할 수 없습니다."),
    pros: aiReport?.pros ?? [],
    cons: aiReport?.cons ?? [],
    sources: news,
  };

  const marketSignal = getMarketSignal({
    qoq: report.revenue.qoq,
    yoy: report.revenue.yoy,
    sentiment: report.news.sentiment,
  });

  return {
    report,
    aiReady: Boolean(aiReport),
    errorReason,
    marketSignal,
    generatedAt: new Date().toISOString(),
  };
}

export async function getRevenueReport(rawSymbol: string) {
  const cache = getGlobalReportCache();
  const resolved = await resolveCompany(rawSymbol);
  const companyName = resolved.name || rawSymbol;
  const ticker = resolved.ticker || rawSymbol;

  const revenueCacheKey = `revenue-data:${ticker}`;
  const expiry = getNextExpiry();

  let marketData = cache.get(revenueCacheKey)?.data;
  if (!marketData || cache.get(revenueCacheKey)!.expiresAt < Date.now()) {
    const [revenues, chartData, quote] = (await Promise.all([
      fetchQuarterlyRevenue(ticker, companyName),
      withTimeout(fetchRecentChart(ticker), 2000, []),
      withTimeout(
        yahooFinance.quote(ticker).catch((e) => {
          console.warn(`[Quote API Failed] ${ticker}:`, e);
          return null;
        }),
        2000,
        null
      ),
    ])) as [any[], any[], any];

    const price = buildPriceFromQuote(quote, chartData);
    marketData = { revenues, chartData, price };
    if (revenues.length > 0) {
      cache.set(revenueCacheKey, { expiresAt: expiry, data: marketData });
    }
  }

  if (!marketData?.price) {
    const quote = await withTimeout(
      yahooFinance.quote(ticker).catch((e) => {
        console.warn(`[Quote API Failed] ${ticker}:`, e);
        return null;
      }),
      2000,
      null
    );
    const refreshedPrice = buildPriceFromQuote(quote, marketData?.chartData ?? []);
    if (refreshedPrice) {
      marketData = { ...marketData, price: refreshedPrice };
      cache.set(revenueCacheKey, { expiresAt: expiry, data: marketData });
    }
  }

  const revenues = marketData?.revenues ?? [];
  const price = marketData?.price ?? null;
  const revenueSeries = buildRevenueSeries(revenues);
  const annualRevenue = buildAnnualRevenue(revenues);

  const report = {
    ...mockReport,
    companyName,
    revenue: {
      qoq: computeChange(revenues[0]?.revenue, revenues[1]?.revenue),
      yoy: computeChange(revenues[0]?.revenue, revenues[4]?.revenue),
    },
    revenueSeries: revenueSeries ?? mockReport.revenueSeries,
    annualRevenue: annualRevenue.length ? annualRevenue : mockReport.annualRevenue,
    price,
  };

  return {
    report,
    generatedAt: new Date().toISOString(),
  };
}

export async function getNewsReport(rawSymbol: string) {
  const cache = getGlobalReportCache();
  const resolved = await resolveCompany(rawSymbol);
  const companyName = resolved.name || rawSymbol;
  const ticker = resolved.ticker || rawSymbol;

  const newsCacheKey = `news-data:${ticker}`;
  const newsExpiry = Date.now() + 5 * 60 * 1000;

  let newsData = cache.get(newsCacheKey)?.data;
  if (!newsData || cache.get(newsCacheKey)!.expiresAt < Date.now()) {
    newsData = await withTimeout(fetchNews(companyName), 1500, []);
    if (newsData.length > 0) {
      cache.set(newsCacheKey, { expiresAt: newsExpiry, data: newsData });
    }
  }

  const news = newsData ?? [];
  const report = {
    ...mockReport,
    companyName,
    news: {
      sentiment: "neutral" as Sentiment,
      score: 0.5,
      highlights: news.slice(0, 3).map((item: any) => item.title),
    },
    sources: news,
  };

  return {
    report,
    generatedAt: new Date().toISOString(),
  };
}

export async function getMarketReport(rawSymbol: string) {
  const [revenueResult, newsResult] = await Promise.all([
    getRevenueReport(rawSymbol),
    getNewsReport(rawSymbol),
  ]);

  const report = {
    ...mockReport,
    ...(revenueResult.report ?? {}),
    ...(newsResult.report ?? {}),
  };

  return {
    report,
    generatedAt: new Date().toISOString(),
  };
}

export async function getAiReport(rawSymbol: string) {
  const cache = getGlobalReportCache();
  const resolved = await resolveCompany(rawSymbol);
  const companyName = resolved.name || rawSymbol;
  const ticker = resolved.ticker || rawSymbol;

  const revenueCacheKey = `revenue-data:${ticker}`;
  const newsCacheKey = `news-data:${ticker}`;
  const aiCacheKey = `ai-report:${ticker}`;
  const expiry = getNextExpiry();

  const marketData = cache.get(revenueCacheKey)?.data;
  const newsData = cache.get(newsCacheKey)?.data ?? [];
  const revenues = marketData?.revenues ?? [];
  const chartData = marketData?.chartData ?? [];
  const qoq = computeChange(revenues[0]?.revenue, revenues[1]?.revenue);
  const yoy = computeChange(revenues[0]?.revenue, revenues[4]?.revenue);

  let aiReport = cache.get(aiCacheKey)?.data as OpenAIReport | null;
  let errorReason: string | null = null;
  const aiCacheEntry = cache.get(aiCacheKey);
  if (!aiReport || aiCacheEntry!.expiresAt < Date.now()) {
    const fallbackModels = [
      "gemini-2.5-flash",
      "gemini-2.5-flash-light",
      "gemini-3-flash-preview",
      "gemini-3-flash",
    ];
    for (const modelName of fallbackModels) {
      try {
        aiReport = await callGemini(
          { companyName, qoq, yoy, news: newsData, chartData },
          modelName,
          1,
          15000
        );
        if (aiReport) {
          cache.set(aiCacheKey, { expiresAt: expiry, data: aiReport });
          errorReason = null;
          break;
        }
      } catch (e: any) {
        errorReason = e.message;
        if (e.message.includes("timeout")) break;
        if (e.message.includes("429") || e.message.includes("404")) continue;
        break;
      }
    }
  }

  const report = {
    companyName,
    news: {
      sentiment: aiReport?.sentiment ?? ("neutral" as Sentiment),
      score: aiReport?.sentimentScore ?? 0.5,
    },
    summary: aiReport?.summary ?? "",
    narrative: aiReport?.narrative ?? "",
    technicalAnalysis:
      aiReport?.technicalAnalysis ??
      (errorReason?.includes("429")
        ? "AI 사용량 초과입니다."
        : "데이터가 부족하여 기술적 분석을 제공할 수 없습니다."),
    pros: aiReport?.pros ?? [],
    cons: aiReport?.cons ?? [],
  };

  return {
    report,
    aiReady: Boolean(aiReport),
    errorReason,
    generatedAt: new Date().toISOString(),
  };
}
