import dynamic from "next/dynamic";
import type { CandlestickData } from "lightweight-charts";
import type { Timeframe, Report } from "@/lib/mock";

const PriceChart = dynamic(() => import("../PriceChart"), {
  ssr: false,
  loading: () => (
    <div className="h-[360px] w-full rounded-xl border border-zinc-800 bg-zinc-950/60" />
  ),
});

type MainReportSectionProps = {
  timeframes: Timeframe[];
  timeframe: Timeframe;
  onTimeframeChange: (value: Timeframe) => void;
  chartData: CandlestickData[];
  isChartLoading: boolean;
  chartError: string | null;
  isReportLoading: boolean;
  reportError: string | null;
  reportData: Report | null;
  report: Report | null;
};

export default function MainReportSection({
  timeframes,
  timeframe,
  onTimeframeChange,
  chartData,
  isChartLoading,
  chartError,
  isReportLoading,
  reportError,
  reportData,
  report,
}: MainReportSectionProps) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-zinc-100">차트</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {timeframes.map((item) => (
            <button
              key={item}
              onClick={() => onTimeframeChange(item)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                timeframe === item
                  ? "border-zinc-100 bg-zinc-100 text-zinc-900"
                  : "border-zinc-700 text-zinc-300 hover:border-zinc-500"
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="relative">
        <PriceChart data={chartData} />
        {isChartLoading ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-zinc-950/60 text-sm text-zinc-300">
            차트 로딩 중...
          </div>
        ) : chartError ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-zinc-950/60 text-sm text-amber-500/80">
            {chartError}
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-zinc-200">AI 진단</p>
      </div>
      {isReportLoading ? (
        <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="h-4 w-1/2 animate-pulse rounded bg-zinc-800" />
          <div className="h-4 w-full animate-pulse rounded bg-zinc-800" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-zinc-800" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-zinc-800" />
        </div>
      ) : (
        <>
          {reportError && !reportData && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-400">
              {reportError}
            </div>
          )}
          {report && (
            <>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-300">
                {reportError && reportData && (
                  <p className="mb-2 text-[10px] text-amber-500/80">
                    {reportError}
                  </p>
                )}
                <p className="mt-2 leading-7 text-zinc-400">
                  {report.narrative}
                </p>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-300">
                  <p className="font-semibold text-zinc-100">장점</p>
                  <ul className="mt-2 list-disc space-y-2 pl-4 text-zinc-400">
                    {report.pros.map((item: string) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-300">
                  <p className="font-semibold text-zinc-100">단점</p>
                  <ul className="mt-2 list-disc space-y-2 pl-4 text-zinc-400">
                    {report.cons.map((item: string) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
