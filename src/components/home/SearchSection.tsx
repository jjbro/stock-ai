import React from "react";
import type { SymbolEntry } from "@/lib/symbols";

type SearchSectionProps = {
  displayName: string;
  price: {
    current?: number;
    change?: number;
    changePercent?: number;
    currency?: string;
  } | null;
  inputValue: string;
  onInputChange: (value: string) => void;
  onInputFocus: () => void;
  onInputBlur: () => void;
  onInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  isDropdownOpen: boolean;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  onDropdownScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  visibleOptions: SymbolEntry[];
  highlightedIndex: number;
  paddingTop: number;
  paddingBottom: number;
  onSelectOption: (entry: SymbolEntry) => void;
  searchError: string | null;
  onSearch: () => void;
};

export default function SearchSection({
  displayName,
  price,
  inputValue,
  onInputChange,
  onInputFocus,
  onInputBlur,
  onInputKeyDown,
  isDropdownOpen,
  dropdownRef,
  onDropdownScroll,
  visibleOptions,
  highlightedIndex,
  paddingTop,
  paddingBottom,
  onSelectOption,
  searchError,
  onSearch,
}: SearchSectionProps) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-xs uppercase text-zinc-500">
            종목 정보
          </p>
          <div className="flex items-baseline gap-3">
            <h2 className="text-xl font-semibold text-zinc-100">{displayName}</h2>
            {price?.current ? (
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-bold text-zinc-100">
                  {price.current?.toLocaleString()}
                  <span className="ml-0.5 text-xs font-normal text-zinc-500">
                    {price.currency}
                  </span>
                </span>
                <span
                  className={`text-sm font-medium ${
                    (price.change ?? 0) > 0
                      ? "text-red-400"
                      : (price.change ?? 0) < 0
                      ? "text-blue-400"
                      : "text-zinc-400"
                  }`}
                >
                  {(price.change ?? 0) > 0 ? "▲" : (price.change ?? 0) < 0 ? "▼" : ""}
                  {Math.abs(price.change ?? 0).toLocaleString()} (
                  {(price.changePercent ?? 0).toFixed(2)}%)
                </span>
              </div>
            ) : (
              <span className="text-sm text-zinc-500">실시간 가격 없음</span>
            )}
          </div>
        </div>
        <div className="flex w-full flex-col gap-3 md:w-auto md:flex-row md:items-center">
          <div className="relative w-full md:w-64">
            <input
              value={inputValue}
              onChange={(event) => onInputChange(event.target.value)}
              onFocus={onInputFocus}
              onBlur={onInputBlur}
              onKeyDown={onInputKeyDown}
              placeholder="종목명 또는 티커"
              className="h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950/60 px-4 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none"
            />
            {searchError ? (
              <p className="mt-2 text-sm text-red-400">{searchError}</p>
            ) : null}
            {isDropdownOpen && visibleOptions.length ? (
              <div
                ref={dropdownRef}
                onScroll={onDropdownScroll}
                className="scrollbar-only absolute left-0 right-0 z-20 mt-2 max-h-[480px] overflow-auto rounded-xl border border-zinc-800 bg-zinc-950/95 py-2 text-sm text-zinc-200 shadow-lg"
              >
                <div style={{ height: paddingTop }} />
                {visibleOptions.map((entry, idx) => (
                  <button
                    key={entry.ticker}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onSelectOption(entry)}
                    className={`flex h-10 w-full items-center justify-between px-4 text-left ${
                      highlightedIndex === idx ? "bg-zinc-900 text-zinc-100" : "hover:bg-zinc-900"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span>{entry.name}</span>
                      <span className="text-xs text-zinc-500">
                        ({entry.ticker.split(".")[0]})
                      </span>
                    </span>
                    {entry.searchNames && entry.searchNames.length > 2 && (
                      <span className="max-w-[100px] truncate text-[10px] text-zinc-600">
                        {entry.searchNames.slice(1, 3).join(", ")}
                      </span>
                    )}
                  </button>
                ))}
                <div style={{ height: paddingBottom }} />
              </div>
            ) : null}
          </div>
          <button
            onClick={onSearch}
            className="h-11 self-start cursor-pointer rounded-xl bg-zinc-100 px-5 text-sm font-semibold text-zinc-900"
          >
            검색
          </button>
        </div>
      </div>
    </section>
  );
}
