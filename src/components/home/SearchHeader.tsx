type CachedReport = { symbol: string; name: string };

type SearchHeaderProps = {
  cachedReports: CachedReport[];
  onSelectCached: (item: CachedReport) => void;
};

export default function SearchHeader({
  cachedReports,
  onSelectCached,
}: SearchHeaderProps) {
  return (
    <header className="flex flex-col gap-2">
      <h1 className="text-3xl font-semibold text-zinc-100 md:text-4xl">
        주식 종목 검색(차트 + AI 리포트)
      </h1>
      <p className="max-w-2xl text-base text-zinc-400">
        종목을 검색하세요. AI가 진단 내용을 보여줍니다.
      </p>
      {cachedReports.length > 0 ? (
        <div className="flex flex-col gap-2 mt-2">
          <p className="text-xs uppercase text-zinc-500">검색한 종목</p>
          <div className="scrollbar-only flex gap-2 overflow-x-auto pb-1">
            {cachedReports.map((item) => (
              <button
                key={item.symbol}
                type="button"
                onClick={() => onSelectCached(item)}
                className="whitespace-nowrap rounded-full border border-zinc-700 bg-zinc-950/60 px-3 py-1 text-xs font-semibold text-zinc-200 hover:border-zinc-500"
              >
                {item.name} ({item.symbol.split(".")[0]})
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </header>
  );
}
