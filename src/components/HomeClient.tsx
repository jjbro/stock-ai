"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { mockReport, type Timeframe, type Report } from "@/lib/mock";
import type { CandlestickData } from "lightweight-charts";
import { SymbolEntry, fallbackSymbolDirectory, cleanStockName } from "@/lib/symbols";
import SearchHeader from "./home/SearchHeader";
import SearchSection from "./home/SearchSection";

const MainReportSection = dynamic(() => import("./home/MainReportSection"), {
  ssr: false,
  loading: () => (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
      <div className="h-6 w-24 rounded bg-zinc-800/70" />
      <div className="mt-4 h-[360px] rounded-xl bg-zinc-800/50" />
      <div className="mt-6 h-4 w-1/3 rounded bg-zinc-800/70" />
      <div className="mt-3 space-y-2">
        <div className="h-4 w-full rounded bg-zinc-800/50" />
        <div className="h-4 w-5/6 rounded bg-zinc-800/50" />
        <div className="h-4 w-2/3 rounded bg-zinc-800/50" />
      </div>
    </div>
  ),
});

const SideReportSection = dynamic(() => import("./home/SideReportSection"), {
  ssr: false,
  loading: () => (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
      <div className="h-4 w-1/2 rounded bg-zinc-800/70" />
      <div className="mt-3 space-y-2">
        <div className="h-4 w-full rounded bg-zinc-800/50" />
        <div className="h-4 w-5/6 rounded bg-zinc-800/50" />
        <div className="h-4 w-2/3 rounded bg-zinc-800/50" />
      </div>
      <div className="mt-6 h-28 rounded-xl bg-zinc-800/50" />
      <div className="mt-6 space-y-2">
        <div className="h-4 w-1/3 rounded bg-zinc-800/70" />
        <div className="h-4 w-full rounded bg-zinc-800/50" />
        <div className="h-4 w-5/6 rounded bg-zinc-800/50" />
      </div>
    </div>
  ),
});

const timeframes: Timeframe[] = ["1D", "1W", "1M", "1Y"];
const CHART_CACHE_TTL_MS = 1000 * 60 * 5;

function normalizeReportError(errorReason?: string | null) {
  if (!errorReason) return null;
  if (errorReason.includes("Gemini API 오류 (429)")) {
    return "AI 사용량 초과입니다.";
  }
  if (errorReason.includes("Gemini API 오류")) {
    return "AI 진단을 생성하지 못했습니다.";
  }
  return errorReason;
}

export default function HomeClient({
  initialSymbols,
}: {
  initialSymbols?: SymbolEntry[];
}) {
  const [symbol, setSymbol] = useState("000660.KS");
  const [displayName, setDisplayName] = useState("SK하이닉스 (000660)");
  const [inputValue, setInputValue] = useState("하이닉스");
  const [timeframe, setTimeframe] = useState<Timeframe>("1D");
  const [chartData, setChartData] = useState<CandlestickData[]>([]);
  const [chartError, setChartError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isChartLoading, setIsChartLoading] = useState(false);
  const [symbolOptions, setSymbolOptions] = useState<SymbolEntry[]>(
    initialSymbols && initialSymbols.length
      ? initialSymbols
      : fallbackSymbolDirectory
  );
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [dropdownScrollTop, setDropdownScrollTop] = useState(0);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const didNavigateRef = useRef(false);
  const isInitialLoadRef = useRef(true);
  const initialSymbolRef = useRef("005930.KS");
  const pendingReportSymbolRef = useRef<string | null>(null);
  const isSyncingScrollRef = useRef(false);
  const scrollRafRef = useRef<number | null>(null);
  const queryClient = useQueryClient();
  const [cachedReports, setCachedReports] = useState<
    { symbol: string; name: string }[]
  >([]);
  const cachedReportsSigRef = useRef<string>("");
  const chartCacheRef = useRef<
    Map<string, { candles: CandlestickData[]; updatedAt: number }>
  >(new Map());
  const abortRef = useRef<AbortController | null>(null);
  const aiRetryAttemptedRef = useRef(false);
  const aiRetryTimeoutRef = useRef<number | null>(null);

  const revenueQuery = useQuery({
    queryKey: ["revenue", symbol],
    queryFn: async ({ signal }) => {
      const controller = new AbortController();
      if (signal) {
        signal.addEventListener("abort", () => controller.abort(), {
          once: true,
        });
      }
      const timeoutId = window.setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(
          `/api/revenue?symbol=${encodeURIComponent(symbol)}`,
          { signal: controller.signal }
        );
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.errorReason || "영업이익 데이터를 불러오지 못했습니다.");
        }
        return payload;
      } finally {
        window.clearTimeout(timeoutId);
      }
    },
    enabled: Boolean(symbol),
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    retry: 1,
  });

  const newsQuery = useQuery({
    queryKey: ["news", symbol],
    queryFn: async ({ signal }) => {
      const controller = new AbortController();
      if (signal) {
        signal.addEventListener("abort", () => controller.abort(), {
          once: true,
        });
      }
      const timeoutId = window.setTimeout(() => controller.abort(), 3000);
      try {
        const response = await fetch(
          `/api/news?symbol=${encodeURIComponent(symbol)}`,
          { signal: controller.signal }
        );
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.errorReason || "뉴스 데이터를 불러오지 못했습니다.");
        }
        return payload;
      } finally {
        window.clearTimeout(timeoutId);
      }
    },
    enabled: Boolean(symbol),
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    retry: 1,
  });

  const aiQuery = useQuery({
    queryKey: ["ai", symbol],
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/ai?symbol=${encodeURIComponent(symbol)}`,
        { signal }
      );
      return response.json();
    },
    enabled: Boolean(symbol),
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    retry: 1,
  });

  const revenueReport =
    (revenueQuery.data as { report?: typeof mockReport } | undefined)?.report ??
    null;
  const newsReport =
    (newsQuery.data as { report?: typeof mockReport } | undefined)?.report ??
    null;
  const aiReport =
    (aiQuery.data as { report?: typeof mockReport } | undefined)?.report ?? null;
  const reportError = (() => {
    if (aiQuery.isError) return "AI 진단을 생성하지 못했습니다.";
    const payload = aiQuery.data as
      | { aiReady?: boolean; errorReason?: string | null }
      | undefined;
    if (payload && payload.aiReady === false) {
      return (
        normalizeReportError(payload.errorReason) ||
        "AI 진단을 생성하지 못했습니다."
      );
    }
    return null;
  })();
  const revenueError = (() => {
    if (revenueQuery.isError) return "영업이익 데이터를 불러오지 못했습니다.";
    const payload = revenueQuery.data as { errorReason?: string } | undefined;
    return payload?.errorReason ?? null;
  })();
  const newsError = (() => {
    if (newsQuery.isError) return "뉴스 데이터를 불러오지 못했습니다.";
    const payload = newsQuery.data as { errorReason?: string } | undefined;
    return payload?.errorReason ?? null;
  })();
  const isReportLoading = aiQuery.isFetching && !aiReport;
  const isRevenueLoading = revenueQuery.isFetching && !revenueReport;
  const isNewsLoading = newsQuery.isFetching && !newsReport;

  const report = useMemo(() => {
    if (!revenueReport && !newsReport && !aiReport) return null;
    const merged = {
      ...mockReport,
      ...(revenueReport ?? {}),
      ...(newsReport ?? {}),
      ...(aiReport ?? {}),
    };
    return {
      ...merged,
      companyName:
        merged.companyName || displayName || mockReport.companyName,
      news: {
        ...(newsReport?.news ?? mockReport.news),
        ...(aiReport?.news
          ? {
              sentiment: aiReport.news.sentiment,
              score: aiReport.news.score,
            }
          : {}),
      },
    };
  }, [aiReport, displayName, newsReport, revenueReport]);

  useEffect(() => {
    aiRetryAttemptedRef.current = false;
    if (aiRetryTimeoutRef.current) {
      window.clearTimeout(aiRetryTimeoutRef.current);
      aiRetryTimeoutRef.current = null;
    }
  }, [symbol]);

  useEffect(() => {
    const payload = aiQuery.data as
      | { aiReady?: boolean; errorReason?: string | null }
      | undefined;
    if (!payload || payload.aiReady !== false) return;
    if (aiQuery.isFetching) return;
    if (aiRetryAttemptedRef.current) return;

    const normalized = normalizeReportError(payload.errorReason);
    if (normalized?.includes("AI 사용량 초과")) return;
    if (normalized?.includes("Gemini API 키")) return;
    if (normalized?.includes("서버 응답이 지연")) return;

    aiRetryAttemptedRef.current = true;
    aiRetryTimeoutRef.current = window.setTimeout(() => {
      aiQuery.refetch();
    }, 2500);

    return () => {
      if (aiRetryTimeoutRef.current) {
        window.clearTimeout(aiRetryTimeoutRef.current);
        aiRetryTimeoutRef.current = null;
      }
    };
  }, [aiQuery.data, aiQuery.isFetching, aiQuery.refetch]);

  function getCacheKey(query: string, frame: Timeframe) {
    return `${query}::${frame}`;
  }

  function getLocalCache(key: string) {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(`chart:${key}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as {
        updatedAt: number;
        candles: CandlestickData[];
      };
      if (
        !parsed.updatedAt ||
        Date.now() - parsed.updatedAt > CHART_CACHE_TTL_MS
      ) {
        window.localStorage.removeItem(`chart:${key}`);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function setLocalCache(key: string, candles: CandlestickData[]) {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        `chart:${key}`,
        JSON.stringify({ updatedAt: Date.now(), candles })
      );
    } catch {
      // ignore
    }
  }

  async function fetchChartData(
    query: string,
    frame: Timeframe,
    signal?: AbortSignal
  ) {
    const response = await fetch(
      `/api/chart?symbol=${encodeURIComponent(query)}&timeframe=${frame}`,
      { signal }
    );

    if (!response.ok) {
      try {
        const payload = (await response.json()) as { message?: string };
        throw new Error(payload.message || "not-found");
      } catch {
        throw new Error("not-found");
      }
    }

    const payload = (await response.json()) as {
      ok: boolean;
      symbol: string;
      candles: CandlestickData[];
    };

    return payload;
  }

  const filteredOptions = useMemo(() => {
    const query = inputValue.trim().toLowerCase();
    if (!query) return symbolOptions;
    return symbolOptions.filter((entry) => {
      const nameMatch = entry.name.toLowerCase().includes(query);
      const tickerMatch = entry.ticker.toLowerCase().includes(query);
      const searchNamesMatch = entry.searchNames?.some((alias) =>
        alias.toLowerCase().includes(query)
      );
      return nameMatch || tickerMatch || searchNamesMatch;
    });
  }, [inputValue, symbolOptions]);

  const itemHeight = 40;
  const maxVisibleItems = 12;
  const maxDropdownHeight = itemHeight * maxVisibleItems;
  const totalItems = filteredOptions.length;
  const totalHeight = totalItems * itemHeight;
  const startIndex = Math.max(0, Math.floor(dropdownScrollTop / itemHeight) - 2);
  const endIndex = Math.min(
    totalItems,
    Math.ceil((dropdownScrollTop + maxDropdownHeight) / itemHeight) + 2
  );
  const visibleOptions = filteredOptions.slice(startIndex, endIndex);
  const paddingTop = startIndex * itemHeight;
  const paddingBottom = Math.max(0, totalHeight - paddingTop - visibleOptions.length * itemHeight);

  useEffect(() => {
    setHighlightedIndex(0);
    setDropdownScrollTop(0);
    if (dropdownRef.current) {
      dropdownRef.current.scrollTop = 0;
    }
  }, [inputValue, isDropdownOpen]);

  useEffect(() => {
    if (!dropdownRef.current) return;
    if (dropdownScrollTop > totalHeight) {
      dropdownRef.current.scrollTop = 0;
      setDropdownScrollTop(0);
    }
  }, [dropdownScrollTop, totalHeight]);

  useEffect(() => {
    if (!dropdownRef.current) return;
    const container = dropdownRef.current;
    const top = highlightedIndex * itemHeight;
    const bottom = top + itemHeight;
    if (top < container.scrollTop) {
      isSyncingScrollRef.current = true;
      container.scrollTop = top;
      setDropdownScrollTop(top);
    } else if (bottom > container.scrollTop + maxDropdownHeight) {
      isSyncingScrollRef.current = true;
      container.scrollTop = bottom - maxDropdownHeight;
      setDropdownScrollTop(container.scrollTop);
    }
    if (isSyncingScrollRef.current) {
      window.requestAnimationFrame(() => {
        isSyncingScrollRef.current = false;
      });
    }
  }, [highlightedIndex, maxDropdownHeight]);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const cache = queryClient.getQueryCache();
    const update = () => {
      const entries = cache.findAll({ queryKey: ["ai"] });
      const next = entries
        .map((entry) => {
          const symbol = entry.queryKey[1] as string | undefined;
          if (!symbol) return null;
          const payload = entry.state.data as { report?: Report } | undefined;
          const rawName =
            payload?.report?.companyName ??
            findNameByTicker(symbol)?.name ??
            symbol;
          return {
            symbol,
            name: cleanStockName(rawName),
          };
        })
        .filter(Boolean) as { symbol: string; name: string }[];

      setCachedReports((prev) => {
        const merged = [...prev, ...next];
        const seen = new Set<string>();
        const unique = merged.filter((item) => {
          const base = item.symbol.split(".")[0];
          const key = `${base}:${cleanStockName(item.name)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        unique.sort((a, b) => a.symbol.localeCompare(b.symbol));
        const signature = unique
          .map((item) => `${item.symbol.split(".")[0]}:${cleanStockName(item.name)}`)
          .join("|");
        if (signature === cachedReportsSigRef.current) return prev;
        cachedReportsSigRef.current = signature;
        return unique;
      });
    };

    update();
    return cache.subscribe(update);
  }, [queryClient, symbolOptions]);

  function findTickerByName(input: string) {
    const normalized = cleanStockName(input).toLowerCase();
    if (!normalized) return null;
    return (
      symbolOptions.find(
        (entry) =>
          entry.name.toLowerCase() === normalized ||
          entry.searchNames?.some((alias) => alias.toLowerCase() === normalized)
      ) ?? null
    );
  }

  function findNameByTicker(input: string) {
    const normalized = input.trim().toLowerCase();
    if (!normalized) return null;
    return (
      symbolOptions.find(
        (entry) => entry.ticker.toLowerCase() === normalized
      ) ?? null
    );
  }

  async function handleSearch(queryOverride?: string) {
    const query = (queryOverride ?? inputValue).trim();
    if (!query) return;

    const normalizedTicker = /^\d{6}$/.test(query) ? `${query}.KS` : query;
    const mappedByName = findTickerByName(query);
    const mappedByTicker =
      findNameByTicker(normalizedTicker) ?? findNameByTicker(query);
    const isTickerLike =
      /^\d{6}(\.[A-Z]+)?$/.test(query) || query.includes(".");
    if (!mappedByName && !mappedByTicker && !isTickerLike) {
      pendingReportSymbolRef.current = null;
      setIsChartLoading(false);
      setSearchError("종목을 찾을 수 없습니다.");
      return;
    }

    const resolvedQuery =
      mappedByName?.ticker ?? mappedByTicker?.ticker ?? normalizedTicker;
    const resolvedName = cleanStockName(
      mappedByName?.name ?? mappedByTicker?.name ?? query
    );

    console.log("[Search] query:", query, "resolved:", resolvedQuery, resolvedName);
    isInitialLoadRef.current = false;
    setSymbol(resolvedQuery);
    setDisplayName(resolvedName);
    pendingReportSymbolRef.current = resolvedQuery;

    // If searching for the same symbol, don't clear, but can force refresh if needed
    // However, to ensure user sees "freshness", we clear report error at least
    setSearchError(null);

    // AI 리포트: 새로운 검색 시에는 기존 캐시를 비우고 스켈레톤을 보여주기 위해 resetQueries 사용
    queryClient.resetQueries({ queryKey: ["ai", resolvedQuery] });
    queryClient.resetQueries({ queryKey: ["revenue", resolvedQuery] });
    queryClient.resetQueries({ queryKey: ["news", resolvedQuery] });

    const cacheKey = getCacheKey(resolvedQuery, timeframe);
    const cached = chartCacheRef.current.get(cacheKey);

    if (cached && Date.now() - cached.updatedAt <= CHART_CACHE_TTL_MS) {
      setSymbol(resolvedQuery);
      setDisplayName(resolvedName);
      setChartData(cached.candles);
      return;
    }
    const localCached = getLocalCache(cacheKey);
    if (localCached?.candles) {
      setSymbol(resolvedQuery);
      setDisplayName(resolvedName);
      setChartData(localCached.candles);
      chartCacheRef.current.set(cacheKey, {
        candles: localCached.candles,
        updatedAt: localCached.updatedAt,
      });
      return;
    }

    setIsChartLoading(true);
    try {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const payload = await fetchChartData(
        resolvedQuery,
        timeframe,
        controller.signal
      );
      setSymbol(payload.symbol);
      setDisplayName(resolvedName);
      setChartData(payload.candles);
      chartCacheRef.current.set(cacheKey, {
        candles: payload.candles,
        updatedAt: Date.now(),
      });
      setLocalCache(cacheKey, payload.candles);
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        setSymbol(resolvedQuery);
        setDisplayName(resolvedName);
        setSearchError("종목을 찾을 수 없습니다.");
      }
    } finally {
      setIsChartLoading(false);
    }
  }

  function handleSelectOption(entry: SymbolEntry) {
    setInputValue(entry.name);
    setIsDropdownOpen(false);
    const cleaned = cleanStockName(entry.name);
    const tickerNum = entry.ticker.split(".")[0];
    setDisplayName(`${cleaned} (${tickerNum})`);
    handleSearch(entry.ticker);
  }

  useEffect(() => {
    if (initialSymbols?.length) return;
    fetch("/api/symbols")
      .then((response) => response.json())
      .then((payload: { symbols?: SymbolEntry[] }) => {
        if (payload.symbols?.length) {
          setSymbolOptions(payload.symbols);
        }
      })
      .catch(() => null);
  }, [initialSymbols]);

  useEffect(() => {
    let active = true;
    const cacheKey = getCacheKey(symbol, timeframe);
    const cached = chartCacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.updatedAt <= CHART_CACHE_TTL_MS) {
      setChartData(cached.candles);
      setSearchError(null);
      setChartError(null);
      return () => {
        active = false;
      };
    }
    const localCached = getLocalCache(cacheKey);
    if (localCached?.candles) {
      setChartData(localCached.candles);
      setSearchError(null);
      setChartError(null);
      chartCacheRef.current.set(cacheKey, {
        candles: localCached.candles,
        updatedAt: localCached.updatedAt,
      });
      return () => {
        active = false;
      };
    }

    setIsChartLoading(true);
    setChartError(null);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    fetchChartData(symbol, timeframe, controller.signal)
      .then((payload) => {
        if (!active) return;
        setChartData(payload.candles);
        setSearchError(null);
        setChartError(null);
        const mappedName = findNameByTicker(payload.symbol)?.name;
        if (mappedName) {
          setDisplayName(cleanStockName(mappedName));
        }
        chartCacheRef.current.set(cacheKey, {
          candles: payload.candles,
          updatedAt: Date.now(),
        });
        setLocalCache(cacheKey, payload.candles);
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message =
          error instanceof Error && typeof error.message === "string"
            ? error.message
            : "not-found";
        if (message === "not-found") {
          if (isInitialLoadRef.current) {
            setSearchError("종목을 검색하세요.");
          } else {
            setSearchError("종목을 찾을 수 없습니다.");
          }
          setChartError(null);
        } else {
          setSearchError(null);
          setChartError(message);
        }
      })
      .finally(() => {
        if (!active) return;
        setIsChartLoading(false);
        isInitialLoadRef.current = false;
      });

    return () => {
      active = false;
    };
  }, [symbol, timeframe]);


  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10">
        <SearchHeader
          cachedReports={cachedReports}
          onSelectCached={(item) => {
            setInputValue(item.name);
            handleSearch(item.symbol);
          }}
        />

          <SearchSection
            displayName={displayName}
            price={revenueReport?.price ?? null}
          inputValue={inputValue}
          onInputChange={(value) => {
            setInputValue(value);
            setIsDropdownOpen(true);
            didNavigateRef.current = false;
          }}
          onInputFocus={() => setIsDropdownOpen(true)}
          onInputBlur={() => {
            setTimeout(() => setIsDropdownOpen(false), 120);
          }}
          onInputKeyDown={(event) => {
            if (!isDropdownOpen) {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                setIsDropdownOpen(true);
              }
            }
            if (filteredOptions.length) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setHighlightedIndex((prev) =>
                  Math.min(prev + 1, filteredOptions.length - 1)
                );
                didNavigateRef.current = true;
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setHighlightedIndex((prev) => Math.max(prev - 1, 0));
                didNavigateRef.current = true;
                return;
              }
              if (event.key === "Enter" && isDropdownOpen) {
                event.preventDefault();
                if (didNavigateRef.current) {
                  const selected = filteredOptions[highlightedIndex];
                  if (selected) {
                    handleSelectOption(selected);
                  }
                  setIsDropdownOpen(false);
                  return;
                }
              }
            }
            if (event.key === "Enter") {
              event.preventDefault();
              handleSearch();
              setIsDropdownOpen(false);
            }
          }}
          isDropdownOpen={isDropdownOpen}
          dropdownRef={dropdownRef}
          onDropdownScroll={(event) => {
            if (isSyncingScrollRef.current) return;
            const next = event.currentTarget.scrollTop;
            if (scrollRafRef.current) {
              window.cancelAnimationFrame(scrollRafRef.current);
            }
            scrollRafRef.current = window.requestAnimationFrame(() => {
              setDropdownScrollTop(next);
              scrollRafRef.current = null;
            });
          }}
          visibleOptions={visibleOptions}
          highlightedIndex={highlightedIndex - startIndex}
          paddingTop={paddingTop}
          paddingBottom={paddingBottom}
          onSelectOption={handleSelectOption}
          searchError={searchError}
          onSearch={() => handleSearch()}
        />

        <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <MainReportSection
              timeframes={timeframes}
              timeframe={timeframe}
              onTimeframeChange={setTimeframe}
              chartData={chartData}
              isChartLoading={isChartLoading}
              chartError={chartError}
              isReportLoading={isReportLoading}
              reportError={reportError}
              reportData={aiReport}
              report={report}
            />
          </div>
          <div className="min-w-0">
            <SideReportSection
              isReportLoading={isReportLoading}
              isRevenueLoading={isRevenueLoading}
              isNewsLoading={isNewsLoading}
              reportError={reportError}
              revenueError={revenueError}
              newsError={newsError}
              revenueData={revenueReport}
              newsData={newsReport}
              report={report}
            />
          </div>
        </div>
        <footer className="text-xs text-red-400">
          <span className="inline-flex items-center gap-1">
            <span className="relative -top-px text-zinc-400" aria-hidden="true">⚠️</span>
            빠르게 재검색을 하거나, 사용량이 많을 경우 검색 시 AI 조회가 어렵습니다.
          </span>
        </footer>
      </div>
    </div>
  );
}
