export type SymbolEntry = {
  name: string;
  ticker: string;
  searchNames?: string[];
};

export function cleanStockName(name: string) {
  return name
    .replace(/에스케이하이닉스/g, "SK하이닉스")
    .replace(/\(주\)/g, "")
    .replace(/주식회사/g, "")
    .replace(/\(유\)/g, "")
    .replace(/유한회사/g, "")
    .replace(/보통주/g, "")
    .replace(/1우$/g, "우")
    .replace(/우선주$/g, "우")
    .replace(/\s+/g, " ")
    .trim();
}

export const fallbackSymbolDirectory: SymbolEntry[] = [
  {
    name: "SK하이닉스",
    ticker: "000660.KS",
    searchNames: ["sk하이닉스", "하이닉스", "닉스", "hynix"],
  },
  {
    name: "삼성전자",
    ticker: "005930.KS",
    searchNames: ["삼성전자", "삼전", "삼성", "samsung"],
  },
  {
    name: "LG에너지솔루션",
    ticker: "373220.KS",
    searchNames: ["lg에너지솔루션", "엔솔", "엘엔솔", "lgensol"],
  },
  {
    name: "삼성바이오로직스",
    ticker: "207940.KS",
    searchNames: ["삼성바이오로직스", "삼바", "삼바공", "sambio"],
  },
  {
    name: "현대차",
    ticker: "005380.KS",
    searchNames: ["현대차", "현대자동차", "hyundai"],
  },
  {
    name: "기아",
    ticker: "000270.KS",
    searchNames: ["기아", "기아차", "kia"],
  },
  {
    name: "셀트리온",
    ticker: "068270.KS",
    searchNames: ["셀트리온", "셀트", "celltrion"],
  },
  {
    name: "POSCO홀딩스",
    ticker: "005490.KS",
    searchNames: ["posco홀딩스", "포스코", "홀딩스", "posco"],
  },
  {
    name: "NAVER",
    ticker: "035420.KS",
    searchNames: ["naver", "네이버"],
  },
  {
    name: "카카오",
    ticker: "035720.KS",
    searchNames: ["카카오", "kakao"],
  },
  {
    name: "에코프로비엠",
    ticker: "247540.KQ",
    searchNames: ["에코프로비엠", "에코비엠", "bm"],
  },
  {
    name: "에코프로",
    ticker: "086520.KQ",
    searchNames: ["에코프로", "에코"],
  },
  {
    name: "알테오젠",
    ticker: "196170.KQ",
    searchNames: ["알테오젠", "알테"],
  },
  {
    name: "한화에어로스페이스",
    ticker: "012450.KS",
    searchNames: ["한화에어로스페이스", "한화에어로", "에어로"],
  },
  {
    name: "카카오뱅크",
    ticker: "323410.KS",
    searchNames: ["카카오뱅크", "카뱅"],
  },
].map(s => ({ ...s, name: cleanStockName(s.name) }));
