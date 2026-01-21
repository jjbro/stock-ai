import iconv from "iconv-lite";
import { readdir, readFile } from "fs/promises";
import path from "path";
import { SymbolEntry, cleanStockName } from "./symbols";

type CacheEntry = {
  data: SymbolEntry[];
  expiresAt: number;
};

const cacheKey = "__krx_symbol_cache_v2__";
const cacheTtlMs = 12 * 60 * 60 * 1000;

const STOCK_ALIASES: Record<string, string[]> = {
  "005930": ["삼성전자", "삼전", "삼성", "samsung"],
  "000660": ["sk하이닉스", "하이닉스", "닉스", "hynix"],
  "373220": ["lg에너지솔루션", "엔솔", "엘엔솔", "lgensol"],
  "207940": ["삼성바이오로직스", "삼바", "삼바공", "sambio"],
  "005380": ["현대자동차", "현대차", "hyundai"],
  "000270": ["기아", "기아차", "kia"],
  "068270": ["셀트리온", "셀트", "celltrion"],
  "005490": ["posco홀딩스", "포스코", "홀딩스", "posco"],
  "035420": ["naver", "네이버"],
  "035720": ["카카오", "kakao"],
  "051910": ["lg화학", "엘화", "lgchem"],
  "105560": ["kb금융", "케이비", "kbfng"],
  "055550": ["신한지주", "신한", "shinhan"],
  "003670": ["포스코퓨처엠", "퓨처엠", "futurem"],
  "012450": ["한화에어로스페이스", "한화에어로", "에어로"],
  "247540": ["에코프로비엠", "에코비엠", "bm"],
  "086520": ["에코프로", "에코"],
  "196170": ["알테오젠", "알테"],
  "323410": ["카카오뱅크", "카뱅"],
  "377300": ["카카오페이", "카페"],
  "010130": ["고려아연", "아연"],
  "000100": ["유한양행", "유한"],
  "096770": ["sk이노베이션", "이노", "sk이노"],
  "030200": ["kt", "케이티"],
  "017670": ["sk텔레콤", "sk텔", "에스케이텔레콤"],
  "015760": ["한국전력", "한전", "kepco"],
  "009150": ["삼성전기", "전기"],
  "033780": ["kt&g", "케이티앤지", "인삼공사"],
  "003550": ["lg", "엘지"],
  "034220": ["lg디스플레이", "엘디플"],
  "066570": ["lg전자", "엘전"],
  "097950": ["cj제일제당", "제당"],
  "001040": ["cj", "씨제이"],
  "028260": ["삼성물산", "삼물"],
  "010140": ["삼성중공업", "삼중"],
  "012330": ["현대모비스", "모비스"],
  "000810": ["삼성화재", "삼화"],
  "032830": ["삼성생명", "삼생"],
  "086790": ["하나금융지주", "하나금융"],
  "316140": ["우리금융지주", "우리금융"],
};

function getCache(): CacheEntry | null {
  const globalAny = globalThis as typeof globalThis & {
    [cacheKey]?: CacheEntry;
  };
  const cached = globalAny[cacheKey];
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) return null;
  return cached;
}

function setCache(data: SymbolEntry[]) {
  const globalAny = globalThis as typeof globalThis & {
    [cacheKey]?: CacheEntry;
  };
  globalAny[cacheKey] = {
    data,
    expiresAt: Date.now() + cacheTtlMs,
  };
}

function normalizeStockData(
  code: string,
  name: string,
  market: string,
  fallbackMarket?: "KS" | "KQ"
): SymbolEntry | null {
  if (!code || !name) return null;

  const rawCode = code.padStart(6, "0");

  // 1. Ticker 변환 (.KS / .KQ)
  const suffix = market.includes("KOSDAQ")
    ? "KQ"
    : market.includes("KOSPI")
      ? "KS"
      : fallbackMarket ?? "KS";
  const ticker = `${rawCode}.${suffix}`;

  // 2. 이름 정제 (공통 유틸리티 사용)
  const cleanedName = cleanStockName(name);

  // 3. 검색 별칭 (사람들이 자주 검색하는 명칭 대응)
  const aliases: string[] = [cleanedName.toLowerCase(), rawCode];

  // 미리 정의된 주요 종목 별칭 추가
  const preDefined = STOCK_ALIASES[rawCode];
  if (preDefined) {
    preDefined.forEach((a) => aliases.push(a));
  }

  // 현대자동차 -> 현대차 (STOCK_ALIASES에 누락된 경우를 위한 안전장치)
  if (cleanedName.includes("현대자동차")) aliases.push("현대차");
  // 네이버/NAVER 대응
  if (cleanedName.toUpperCase() === "NAVER") aliases.push("네이버");
  if (cleanedName === "네이버") aliases.push("naver");
  // 기아자동차 -> 기아
  if (cleanedName.includes("기아자동차") || cleanedName === "기아") {
    aliases.push("기아");
    aliases.push("기아차");
  }
  // 카카오 계열사
  if (cleanedName.includes("카카오")) {
    aliases.push("카카오");
  }
  // 에스케이 -> SK
  if (cleanedName.includes("에스케이")) {
    aliases.push(cleanedName.replace("에스케이", "SK"));
    aliases.push("SK");
  }

  // 추가 정제 룰: 영문/한글 혼용 시 공백 제거 버전 추가
  const noSpace = cleanedName.replace(/\s/g, "");
  if (noSpace !== cleanedName) aliases.push(noSpace.toLowerCase());

  return {
    name: cleanedName,
    ticker,
    searchNames: Array.from(new Set(aliases.map((a) => a.toLowerCase()))),
  };
}

function parseCsv(
  content: string,
  fallbackMarket?: "KS" | "KQ"
): SymbolEntry[] {
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = parseCsvRow(lines[0]);
  const codeIndex = header.findIndex(
    (value) => value.includes("종목코드") || value.includes("단축코드")
  );
  const nameIndex = header.findIndex(
    (value) => value.includes("종목명") || value.includes("종목약명")
  );
  const marketIndex = header.findIndex((value) =>
    value.includes("시장구분")
  );

  if (codeIndex < 0 || nameIndex < 0) {
    return [];
  }

  return lines
    .slice(1)
    .map((line) => {
      const row = parseCsvRow(line);
      const code = row[codeIndex]?.trim() ?? "";
      const name = row[nameIndex]?.trim() ?? "";
      const market = marketIndex >= 0 ? row[marketIndex]?.trim() ?? "" : "";
      return normalizeStockData(code, name, market, fallbackMarket);
    })
    .filter(Boolean) as SymbolEntry[];
}

function decodeCsvBuffer(buffer: Buffer) {
  const decodedEuc = iconv.decode(buffer, "euc-kr");
  if (decodedEuc.includes("종목") || decodedEuc.includes("시장")) {
    return decodedEuc;
  }
  return buffer.toString("utf-8");
}

function parseCsvRow(line: string): string[] {
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

async function readLocalCsv(): Promise<SymbolEntry[] | null> {
  if (process.env.NODE_ENV === "production") return null;
  const dataDir = path.join(process.cwd(), "data");
  const localPath = path.join(dataDir, "krx.csv");
  try {
    const file = await readFile(localPath);
    const decoded = decodeCsvBuffer(file);
    const parsed = parseCsv(decoded);
    if (parsed.length) return parsed;
  } catch {
    // ignore
  }

  try {
    const files = await readdir(dataDir);
    const infoFile =
      files.find((name) => name.startsWith("data_3420_")) ??
      files.find((name) => name.startsWith("data_3404_"));
    if (!infoFile) return null;
    const file = await readFile(path.join(dataDir, infoFile));
    const decoded = decodeCsvBuffer(file);
    return parseCsv(decoded);
  } catch {
    return null;
  }
}

async function fetchKrxCsv(date: string): Promise<SymbolEntry[] | null> {
  const otpUrl = "https://data.krx.co.kr/comm/fileDn/GenerateOTP/generate.cmd";
  const downloadUrl =
    "https://data.krx.co.kr/comm/fileDn/download_csv/download.cmd";
  const form = new URLSearchParams({
    locale: "ko_KR",
    mktId: "ALL",
    trdDd: date,
    share: "1",
    money: "1",
    csvxls_isNo: "csv",
    name: "fileDown",
    url: "dbms/MDC/STAT/standard/MDCSTAT01901",
  });

  const otpRes = await fetch(otpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Referer: "https://data.krx.co.kr/",
    },
    body: form.toString(),
    cache: "no-store",
  });

  if (!otpRes.ok) return null;
  const otp = await otpRes.text();
  if (!otp) return null;

  const csvRes = await fetch(downloadUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Referer: "https://data.krx.co.kr/",
    },
    body: new URLSearchParams({ code: otp }).toString(),
    cache: "no-store",
  });

  if (!csvRes.ok) return null;
  const buffer = Buffer.from(await csvRes.arrayBuffer());
  const decoded = iconv.decode(buffer, "euc-kr");
  return parseCsv(decoded);
}

async function fetchKindCsv(
  marketType: string,
  fallbackMarket: "KS" | "KQ"
): Promise<SymbolEntry[] | null> {
  const url = new URL("https://kind.krx.co.kr/corpgeneral/corpList.do");
  url.searchParams.set("method", "download");
  url.searchParams.set("marketType", marketType);

  const response = await fetch(url.toString(), {
    headers: { "User-Agent": "Mozilla/5.0", Referer: "https://kind.krx.co.kr/" },
    cache: "no-store",
  });

  if (!response.ok) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) return null;
  const decoded = iconv.decode(buffer, "euc-kr");
  return parseCsv(decoded, fallbackMarket);
}

async function fetchKindMerged(): Promise<SymbolEntry[] | null> {
  const kospi = await fetchKindCsv("stockMkt", "KS");
  const kosdaq = await fetchKindCsv("kosdaqMkt", "KQ");
  const merged = [...(kospi ?? []), ...(kosdaq ?? [])].filter(Boolean);
  return merged.length ? merged : null;
}

function getRecentDates(limit = 7) {
  const dates: string[] = [];
  const now = new Date();
  for (let i = 0; i < limit; i += 1) {
    const date = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i)
    );
    const yyyy = String(date.getUTCFullYear());
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(date.getUTCDate()).padStart(2, "0");
    dates.push(`${yyyy}${mm}${dd}`);
  }
  return dates;
}

export async function getKrxSymbols(): Promise<SymbolEntry[]> {
  const cached = getCache();
  if (cached) return cached.data;

  const local = await readLocalCsv();
  if (local && local.length) {
    setCache(local);
    return local;
  }

  for (const date of getRecentDates()) {
    try {
      const data = await fetchKrxCsv(date);
      if (data && data.length) {
        setCache(data);
        return data;
      }
    } catch {
      continue;
    }
  }

  try {
    const kindData = await fetchKindMerged();
    if (kindData && kindData.length) {
      setCache(kindData);
      return kindData;
    }
  } catch {
    return [];
  }

  return [];
}
