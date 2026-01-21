import React from "react";
import RevenueLineChart from "../RevenueLineChart";

type SideReportSectionProps = {
  isReportLoading: boolean;
  isMarketLoading: boolean;
  reportError: string | null;
  marketError: string | null;
  reportData: any | null;
  report: any | null;
};

export default function SideReportSection({
  isReportLoading,
  isMarketLoading,
  reportError,
  marketError,
  reportData,
  report,
}: SideReportSectionProps) {
  const marketReport = reportData ?? report;
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
      {isReportLoading ? (
        <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
            AI가 분석중입니다
            <span className="loading-ellipsis" aria-hidden="true">...</span>
          </p>
          <div className="h-4 w-2/3 animate-pulse rounded bg-zinc-800" />
          <div className="h-4 w-full animate-pulse rounded bg-zinc-800" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-zinc-800" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-zinc-800" />
        </div>
      ) : (
        <>
          {reportError && !reportData && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-400">
              AI 진단을 생성하지 못했습니다.
            </div>
          )}
        </>
      )}

      {isMarketLoading ? (
        <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="h-4 w-1/3 animate-pulse rounded bg-zinc-800" />
          <div className="h-28 w-full animate-pulse rounded bg-zinc-800" />
        </div>
      ) : marketReport ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-300">
          <p className="font-semibold text-zinc-100">매출 비교</p>
          {marketReport.revenueSeries.currentYear.points.length === 0 ? (
            <p className="mt-4 text-amber-500/80">
              {reportError || "매출이 확인되지 않습니다."}
            </p>
          ) : (
            <RevenueLineChart
              currentYear={marketReport.revenueSeries.currentYear}
              previousYear={marketReport.revenueSeries.previousYear}
            />
          )}
        </div>
      ) : marketError ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-amber-500/80">
          {marketError}
        </div>
      ) : null}

      {isMarketLoading ? (
        <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="h-4 w-1/3 animate-pulse rounded bg-zinc-800" />
          <div className="h-4 w-full animate-pulse rounded bg-zinc-800" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-zinc-800" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-zinc-800" />
        </div>
      ) : marketReport ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-300">
          <p className="font-semibold text-zinc-100">관련 뉴스</p>
          {marketReport.sources.length === 0 ? (
            <p className="mt-4 text-amber-500/80">
              {reportError || "관련종목의 최근 뉴스가 없습니다."}
            </p>
          ) : (
            <ul className="mt-2 space-y-2 text-zinc-400">
              {marketReport.sources.map((source: { url: string; title: string }) => (
                <li key={source.url}>
                  <a
                    href={source.url}
                    className="hover:text-zinc-200"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {source.title}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : marketError ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-amber-500/80">
          {marketError}
        </div>
      ) : null}

      {isReportLoading ? (
        <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="h-4 w-1/3 animate-pulse rounded bg-zinc-800" />
          <div className="h-20 w-full animate-pulse rounded bg-zinc-800" />
        </div>
      ) : report ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-300">
          <p className="font-semibold text-zinc-100">AI 기술적 분석</p>
          <p
            className={`mt-2 whitespace-pre-line leading-6 ${
              reportError && report.technicalAnalysis === reportError
                ? "text-amber-500/80"
                : "text-zinc-400"
            }`}
          >
            {report.technicalAnalysis}
          </p>
        </div>
      ) : null}
      <style jsx>{`
        .loading-ellipsis {
          display: inline-block;
          margin-left: 0.25rem;
          width: 0ch;
          overflow: hidden;
          animation: ellipsis 1.2s steps(4, end) infinite;
        }
        @keyframes ellipsis {
          0% {
            width: 0ch;
          }
          100% {
            width: 3ch;
          }
        }
      `}</style>
    </section>
  );
}
