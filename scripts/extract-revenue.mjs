import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import iconv from "iconv-lite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 매출액 추출 함수 (readline 사용)
async function extractRevenue(filePath) {
  const results = [];
  
  // CP949 인코딩으로 파일 읽기
  const fileStream = createReadStream(filePath);
  const decodedStream = iconv.decodeStream("cp949");
  const rl = createInterface({
    input: fileStream.pipe(decodedStream),
    crlfDelay: Infinity,
  });
  
  let samsungLineCount = 0;
  const samsungAccountIds = new Set();

  for await (const line of rl) {
    if (!line.trim()) continue;
    
    const columns = line.split("\t");
    if (columns.length < 13) continue;
    
    // [1]: 종목코드, [2]: 회사명, [10]: 항목코드, [12]: 당기 금액
    const codeRaw = columns[1]?.trim() || "";
    const companyName = columns[2]?.trim() || "";
    const accountId = columns[10]?.trim() || "";
    const amountStr = columns[12]?.trim() || "";
    
    if (!codeRaw || !accountId || !amountStr) continue;
    
    const corpCode = codeRaw.replace(/[\[\]]/g, "");
    const accountName = columns[11]?.trim() || "";

    if (corpCode === "005930") {
      samsungLineCount += 1;
      if (accountId) samsungAccountIds.add(accountId);
    }

    const isRevenueAccount =
      accountId === "ifrs-full_Revenue" ||
      accountId === "dart_OperatingRevenue" ||
      accountId === "dart_Revenue" ||
      accountId.startsWith("ifrs-full_Revenue") ||
      accountName.includes("매출");

    if (!isRevenueAccount) continue;
    const revenueStr = amountStr.replace(/,/g, "");
    const revenue = parseFloat(revenueStr);
    
    if (!corpCode || !companyName || isNaN(revenue) || revenue === 0) continue;
    
    // 삼성전자 체크 (디버깅용)
    if (corpCode === "005930" || companyName.includes("삼성전자")) {
      console.log(`  [DEBUG] 삼성전자 매출액 발견: corpCode=${corpCode}, companyName=${companyName}, revenue=${revenue}`);
    }
    
    results.push({
      corpCode,
      companyName,
      revenue,
    });
  }
  
  if (samsungLineCount > 0 && !results.some((row) => row.corpCode === "005930")) {
    console.log(
      `  [DEBUG] 삼성전자 매출액 미발견: lines=${samsungLineCount}, accountIds=${Array.from(
        samsungAccountIds
      ).slice(0, 20).join(", ")}`
    );
  }

  return results;
}

// 파일 우선순위 정의
const filePriority = [
  "은행_연결",
  "증권_연결",
  "보험_연결",
  "금융기타_연결",
  "연결", // 마지막에 덮어쓰기
];

// 분기별 파일 패턴
const quarters = [
  { year: 2024, period: "1분기", reportType: "1분기보고서", quarter: "Q1" },
  { year: 2024, period: "반기", reportType: "반기보고서", quarter: "H1" },
  { year: 2024, period: "3분기", reportType: "3분기보고서", quarter: "Q3" },
  { year: 2024, period: "사업보고서", reportType: "사업보고서", quarter: "FY" },
  { year: 2025, period: "1분기", reportType: "1분기보고서", quarter: "Q1" },
  { year: 2025, period: "반기", reportType: "반기보고서", quarter: "H1" },
  { year: 2025, period: "3분기", reportType: "3분기보고서", quarter: "Q3" },
];

// 손익계산서/포괄손익계산서 우선순위 (손익계산서가 매출 포함 가능성이 더 높음)
const statementTypes = [
  { code: "02", label: "손익계산서" },
  { code: "03", label: "포괄손익계산서" },
];

// 결과 저장 구조: { [corpCode]: { [year]: { Q1, Q2, Q3, Q4 } } }
const revenueData = {};

// 각 분기별로 처리
async function processAllFiles() {
  for (const { year, period, reportType, quarter } of quarters) {
    console.log(`\n처리 중: ${year}년 ${period}...`);
    
    // 우선순위에 따라 파일 처리
    for (const priority of filePriority) {
      const dataDir = path.join(__dirname, "..", "data");
      const allFiles = fs.readdirSync(dataDir);

      const candidateFiles = statementTypes
        .flatMap((statement) =>
          allFiles
            .filter((f) =>
              f.match(
                new RegExp(
                  `^${year}_${reportType}_${statement.code}_${statement.label}_${priority}_`
                )
              )
            )
            .map((f) => ({ file: f, statement: statement.label }))
        )
        .sort((a, b) =>
          statementTypes
            .map((s) => s.label)
            .indexOf(a.statement) -
          statementTypes.map((s) => s.label).indexOf(b.statement)
        );

      if (candidateFiles.length === 0) continue;

      for (const candidate of candidateFiles) {
        const filePath = path.join(dataDir, candidate.file);
        console.log(`  읽는 중: ${candidate.file}`);

        const results = await extractRevenue(filePath);
      
        for (const { corpCode, companyName, revenue } of results) {
          if (!revenueData[corpCode]) {
            revenueData[corpCode] = {
              companyName,
              years: {},
            };
          }

          if (!revenueData[corpCode].years[year]) {
            revenueData[corpCode].years[year] = {};
          }

          // 분기별 매출액 저장
          if (quarter === "Q1") {
            revenueData[corpCode].years[year].Q1 = revenue;
          } else if (quarter === "H1") {
            revenueData[corpCode].years[year].H1 = revenue;
          } else if (quarter === "Q3") {
            revenueData[corpCode].years[year].Q3 = revenue;
          } else if (quarter === "FY") {
            revenueData[corpCode].years[year].FY = revenue;
          }
        }
      }
    }
  }
}

// 실행
processAllFiles().then(() => {
  // Q2, Q4 계산 (H1 - Q1, FY - Q3)
  for (const corpCode in revenueData) {
    for (const year in revenueData[corpCode].years) {
      const yearData = revenueData[corpCode].years[year];
      if (yearData.H1 && yearData.Q1) {
        yearData.Q2 = yearData.H1 - yearData.Q1;
      }
      if (yearData.FY && yearData.Q3) {
        yearData.Q4 = yearData.FY - yearData.Q3;
      }
    }
  }

  // 최종 JSON 구조 변환 (DART API 형식과 호환)
  const finalData = {};

  for (const corpCode in revenueData) {
    const company = revenueData[corpCode];
    finalData[corpCode] = {
      companyName: company.companyName,
      revenue: {},
    };
    
    for (const year in company.years) {
      const yearData = company.years[year];
      finalData[corpCode].revenue[year] = {
        Q1: yearData.Q1 || null,
        Q2: yearData.Q2 || null,
        Q3: yearData.Q3 || null,
        Q4: yearData.Q4 || null,
        H1: yearData.H1 || null,
        FY: yearData.FY || null,
      };
    }
  }

  // JSON 파일 저장
  const outputPath = path.join(__dirname, "..", "data", "revenue-data.json");
  fs.writeFileSync(outputPath, JSON.stringify(finalData, null, 2), "utf8");

  console.log(`\n✅ 완료! ${outputPath}에 저장되었습니다.`);
  console.log(`총 ${Object.keys(finalData).length}개 회사의 매출액 데이터가 추출되었습니다.`);

  // 통계 출력
  let totalQuarters = 0;
  for (const corpCode in finalData) {
    for (const year in finalData[corpCode].revenue) {
      const quarters = Object.values(finalData[corpCode].revenue[year]).filter((v) => v !== null);
      totalQuarters += quarters.length;
    }
  }
  console.log(`총 ${totalQuarters}개의 분기 데이터가 포함되어 있습니다.`);
}).catch((error) => {
  console.error("오류 발생:", error);
  process.exit(1);
});
