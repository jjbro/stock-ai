import fs from "fs/promises";
import path from "path";
import iconv from "iconv-lite";

const otpUrl = "https://data.krx.co.kr/comm/fileDn/GenerateOTP/generate.cmd";
const downloadUrl =
  "https://data.krx.co.kr/comm/fileDn/download_csv/download.cmd";
const kindUrl = "https://kind.krx.co.kr/corpgeneral/corpList.do";

async function requestOtp(date) {
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

  const response = await fetch(otpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Referer: "https://data.krx.co.kr/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Origin: "https://data.krx.co.kr",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: form.toString(),
  });

  if (!response.ok) return null;
  const otp = await response.text();
  const setCookie = response.headers.get("set-cookie");
  return { otp: otp?.trim() || null, cookie: setCookie };
}

async function downloadCsv(otp, cookie) {
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    Referer: "https://data.krx.co.kr/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Origin: "https://data.krx.co.kr",
  };
  if (cookie) {
    headers["Cookie"] = cookie;
  }

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

function getRecentDates(limit = 7) {
  const dates = [];
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

function parseCsvRow(line) {
  const result = [];
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

function parseKrxCsv(content) {
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = parseCsvRow(lines[0]);
  const codeIndex = header.findIndex((value) => value.includes("종목코드"));
  const nameIndex = header.findIndex((value) => value.includes("종목명"));
  const marketIndex = header.findIndex((value) => value.includes("시장구분"));
  if (codeIndex < 0 || nameIndex < 0 || marketIndex < 0) return [];

  return lines.slice(1).map((line) => {
    const row = parseCsvRow(line);
    const code = (row[codeIndex] ?? "").trim().padStart(6, "0");
    const name = (row[nameIndex] ?? "").trim();
    const market = (row[marketIndex] ?? "").trim();
    if (!code || !name || !market) return null;
    return { code, name, market };
  });
}

function parseKindHtml(html, marketLabel) {
  const rows = [];
  const tableMatch = html.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch) return [];

  const trs = tableMatch[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
  if (!trs || trs.length < 2) return [];

  const headerRow = trs[0];
  const thTds = headerRow.match(/<(th|td)[^>]*>([\s\S]*?)<\/(th|td)>/gi) || [];
  const header = thTds.map(td => td.replace(/<[^>]*>/g, "").trim());
  
  const nameIndex = header.findIndex(h => h.includes("회사명"));
  const codeIndex = header.findIndex(h => h.includes("종목코드"));

  if (nameIndex < 0 || codeIndex < 0) return [];

  for (let i = 1; i < trs.length; i++) {
    const rowTds = trs[i].match(/<(th|td)[^>]*>([\s\S]*?)<\/(th|td)>/gi) || [];
    const name = (rowTds[nameIndex] || "").replace(/<[^>]*>/g, "").trim();
    const code = (rowTds[codeIndex] || "").replace(/<[^>]*>/g, "").trim().padStart(6, "0");
    if (name && code) {
      rows.push({ code, name, market: marketLabel });
    }
  }
  return rows;
}

async function fetchKindCsv(marketType, marketLabel) {
  const params = new URLSearchParams({
    method: "download",
    marketType,
  });
  const url = `${kindUrl}?${params.toString()}`;
  const response = await fetch(url, {
    headers: {
      Referer: "https://kind.krx.co.kr/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) return [];
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) return [];
  const decoded = iconv.decode(buffer, "euc-kr");
  
  return parseKindHtml(decoded, marketLabel);
}

async function fetchKindMerged() {
  const kospi = await fetchKindCsv("stockMkt", "KOSPI");
  const kosdaq = await fetchKindCsv("kosdaqMkt", "KOSDAQ");
  return [...kospi, ...kosdaq].filter(Boolean);
}

function toStandardCsv(rows) {
  const header = "종목코드,종목명,시장구분";
  const body = rows
    .filter(Boolean)
    .map((row) => `${row.code},${row.name},${row.market}`)
    .join("\n");
  return `${header}\n${body}\n`;
}

async function main() {
  const outDir = path.join(process.cwd(), "data");
  const outPath = path.join(outDir, "krx.csv");

  await fs.mkdir(outDir, { recursive: true });

  for (const date of getRecentDates()) {
    const result = await requestOtp(date);
    if (!result || !result.otp) continue;

    const csvBuffer = await downloadCsv(result.otp, result.cookie);
    if (!csvBuffer) continue;

    const decoded = iconv.decode(csvBuffer, "euc-kr");
    const rows = parseKrxCsv(decoded).filter(Boolean);
    if (rows.length) {
      const csv = toStandardCsv(rows);
      await fs.writeFile(outPath, csv, "utf8");
      console.log(`KRX CSV saved: ${outPath}`);
      return;
    }
  }

  const kindRows = await fetchKindMerged();
  if (kindRows.length) {
    const csv = toStandardCsv(kindRows);
    await fs.writeFile(outPath, csv, "utf8");
    console.log(`KIND CSV saved (fallback): ${outPath}`);
    return;
  }

  console.error("KRX CSV 다운로드 실패");
  process.exitCode = 1;
}

main();
