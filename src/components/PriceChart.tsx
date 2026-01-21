"use client";

import {
  CandlestickSeries,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
} from "lightweight-charts";
import { useEffect, useMemo, useRef } from "react";

type Props = {
  data: CandlestickData[];
};

export default function PriceChart({ data }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const chartOptions = useMemo(
    () => ({
      layout: {
        background: { color: "transparent" },
        textColor: "#e4e4e7",
      },
      grid: {
        vertLines: { color: "rgba(63, 63, 70, 0.5)" },
        horzLines: { color: "rgba(63, 63, 70, 0.5)" },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderVisible: false,
        barSpacing: 8,
        minBarSpacing: 4,
      },
      crosshair: {
        vertLine: {
          labelBackgroundColor: "#27272a",
        },
        horzLine: {
          labelBackgroundColor: "#27272a",
        },
      },
    }),
    []
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      ...chartOptions,
      width: containerRef.current.clientWidth,
      height: 360,
    });
    chartRef.current = chart;

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#ef4444",
      downColor: "#3b82f6",
      borderDownColor: "#3b82f6",
      borderUpColor: "#ef4444",
      wickDownColor: "#3b82f6",
      wickUpColor: "#ef4444",
    });

    seriesRef.current = series;

    const tooltip = document.createElement("div");
    tooltip.className =
      "pointer-events-none absolute z-10 rounded-md border border-zinc-800 bg-zinc-950/90 px-3 py-2 text-xs text-zinc-200";
    tooltip.style.display = "none";
    containerRef.current.style.position = "relative";
    containerRef.current.appendChild(tooltip);
    tooltipRef.current = tooltip;

    const formatTime = (time: unknown) => {
      if (!time) return "";
      if (typeof time === "string") return time;
      if (typeof time === "number") {
        return new Date(time * 1000).toISOString().split("T")[0];
      }
      if (typeof time === "object" && time && "year" in time) {
        const t = time as { year: number; month: number; day: number };
        return `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
      }
      return "";
    };

    chart.subscribeCrosshairMove((param) => {
      if (!tooltipRef.current || !seriesRef.current) return;
      if (!param.time || !param.seriesData) {
        tooltipRef.current.style.display = "none";
        return;
      }
      const bar = param.seriesData.get(seriesRef.current) as CandlestickData | undefined;
      if (!bar) {
        tooltipRef.current.style.display = "none";
        return;
      }
      const time = formatTime(param.time);
      tooltipRef.current.innerHTML = `
        <div class="text-zinc-400">${time}</div>
        <div>시가: ${bar.open?.toLocaleString?.() ?? "-"}</div>
        <div>종가: ${bar.close?.toLocaleString?.() ?? "-"}</div>
      `;
      tooltipRef.current.style.display = "block";
      const container = containerRef.current!;
      const left = Math.min(
        Math.max(0, param.point?.x ?? 0),
        container.clientWidth - tooltipRef.current.offsetWidth
      );
      const top = Math.min(
        Math.max(0, (param.point?.y ?? 0) - 40),
        container.clientHeight - tooltipRef.current.offsetHeight
      );
      tooltipRef.current.style.left = `${left}px`;
      tooltipRef.current.style.top = `${top}px`;
    });

    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      if (tooltipRef.current) {
        tooltipRef.current.remove();
        tooltipRef.current = null;
      }
      chartRef.current = null;
      chart.remove();
    };
  }, [chartOptions]);

  useEffect(() => {
    if (seriesRef.current) {
      seriesRef.current.setData(data);
      chartRef.current?.timeScale().fitContent();
    }
  }, [data]);

  return <div ref={containerRef} className="h-[360px] w-full" />;
}
