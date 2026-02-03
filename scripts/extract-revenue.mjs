import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import iconv from "iconv-lite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 영업이익 추출 함수 (readline 사용)
async function extractOperatingIncome(filePath) {
  const results = [];
  
  // CP949 인코딩으로 파일 읽기
  const fileStream = createReadStream(filePath);
  const decodedStream = iconv.decodeStream("cp949");
  const rl = createInterface({
    input: fileStream.pipe(decodedStream),
    crlfDelay: Infinity,
  });

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

    const isOperatingIncomeAccount =
      accountId === "ifrs-full_ProfitLossFromOperatingActivities" ||
      accountId === "dart_OperatingIncomeLoss" ||
      accountId === "dart_OperatingIncome" ||
      accountId.startsWith("ifrs-full_ProfitLossFromOperatingActivities") ||
      accountName.includes("영업이익") ||
      accountName.includes("영업손익");

    if (!isOperatingIncomeAccount) continue;
    const incomeStr = amountStr.replace(/,/g, "");
    const income = parseFloat(incomeStr);
    
    if (!corpCode || !companyName || isNaN(income)) continue;
    
    results.push({
      corpCode,
      companyName,
      income,
      accountId,
      accountName,
    });
  }

  return results;
}

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
      accountId,
      accountName,
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

// 임시 저장 구조: { [corpCode]: { [year]: { [quarter]: [{ accountId, revenue, priority }] } } }
const tempRevenueData = {};
const tempOperatingIncomeData = {};
// 최종 저장 구조: { [corpCode]: { [year]: { Q1, Q2, Q3, Q4, accountId } } }
const revenueData = {};
const operatingIncomeData = {};

// 계정 코드 우선순위 (높을수록 우선)
function getAccountPriority(accountId, accountName) {
  if (accountId === "ifrs-full_Revenue") return 100;
  if (accountId.startsWith("ifrs-full_Revenue")) return 90;
  if (accountId === "dart_OperatingRevenue") return 80;
  if (accountId === "dart_Revenue") return 70;
  if (accountName.includes("매출")) return 60;
  return 50;
}

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

        const revenueResults = await extractRevenue(filePath);
        const operatingIncomeResults = await extractOperatingIncome(filePath);
      
        // 같은 회사에 대해 여러 매출 항목이 있을 수 있으므로, 우선순위가 높고 같은 계정 코드를 사용
        const revenueByCorp = new Map();
        for (const { corpCode, companyName, revenue, accountId, accountName } of revenueResults) {
          const priority = getAccountPriority(accountId, accountName);
          if (!revenueByCorp.has(corpCode)) {
            revenueByCorp.set(corpCode, { companyName, revenue, accountId, priority });
          } else {
            const existing = revenueByCorp.get(corpCode);
            // 우선순위가 더 높거나, 같은 우선순위면 더 큰 매출액 선택
            if (priority > existing.priority || (priority === existing.priority && revenue > existing.revenue)) {
              revenueByCorp.set(corpCode, { companyName, revenue, accountId, priority });
            }
          }
        }

        for (const [corpCode, { companyName, revenue, accountId, priority }] of revenueByCorp) {
          if (!tempRevenueData[corpCode]) {
            tempRevenueData[corpCode] = {
              companyName,
              years: {},
            };
          }

          if (!tempRevenueData[corpCode].years[year]) {
            tempRevenueData[corpCode].years[year] = {};
          }

          if (!tempRevenueData[corpCode].years[year][quarter]) {
            tempRevenueData[corpCode].years[year][quarter] = [];
          }

          // 모든 계정 코드와 매출액을 임시 저장
          tempRevenueData[corpCode].years[year][quarter].push({
            accountId,
            revenue,
            priority,
          });
        }

        // 영업이익 처리
        const operatingIncomeByCorp = new Map();
        for (const { corpCode, companyName, income, accountId, accountName } of operatingIncomeResults) {
          if (!operatingIncomeByCorp.has(corpCode)) {
            operatingIncomeByCorp.set(corpCode, { companyName, income, accountId });
          } else {
            const existing = operatingIncomeByCorp.get(corpCode);
            // 더 큰 영업이익 선택
            if (Math.abs(income) > Math.abs(existing.income)) {
              operatingIncomeByCorp.set(corpCode, { companyName, income, accountId });
            }
          }
        }

        for (const [corpCode, { companyName, income, accountId }] of operatingIncomeByCorp) {
          if (!tempOperatingIncomeData[corpCode]) {
            tempOperatingIncomeData[corpCode] = {
              companyName,
              years: {},
            };
          }

          if (!tempOperatingIncomeData[corpCode].years[year]) {
            tempOperatingIncomeData[corpCode].years[year] = {};
          }

          if (!tempOperatingIncomeData[corpCode].years[year][quarter]) {
            tempOperatingIncomeData[corpCode].years[year][quarter] = [];
          }

          tempOperatingIncomeData[corpCode].years[year][quarter].push({
            accountId,
            income,
          });
        }
      }
    }
  }
}

// 실행
processAllFiles().then(() => {
  // 각 회사/연도별로 가장 우선순위가 높은 계정 코드를 선택하고, 그 계정 코드로 모든 분기 데이터를 추출
  for (const corpCode in tempRevenueData) {
    const corpData = tempRevenueData[corpCode];
    revenueData[corpCode] = {
      companyName: corpData.companyName,
      years: {},
    };

    for (const year in corpData.years) {
      const yearData = corpData.years[year];
      
      // 모든 분기에서 공통으로 사용된 계정 코드 중 가장 우선순위가 높은 것을 선택
      const accountIdsByQuarter = {};
      for (const quarter in yearData) {
        accountIdsByQuarter[quarter] = new Set();
        for (const item of yearData[quarter]) {
          accountIdsByQuarter[quarter].add(item.accountId);
        }
      }
      
      // 모든 분기에서 공통으로 사용된 계정 코드 찾기
      const quarterKeys = Object.keys(accountIdsByQuarter);
      let commonAccountIds = accountIdsByQuarter[quarterKeys[0]] || new Set();
      for (let i = 1; i < quarterKeys.length; i++) {
        const current = accountIdsByQuarter[quarterKeys[i]] || new Set();
        commonAccountIds = new Set([...commonAccountIds].filter(id => current.has(id)));
      }
      
      // 공통 계정 코드가 없으면, 가장 많은 분기에서 사용된 계정 코드 선택
      if (commonAccountIds.size === 0) {
        const accountIdCounts = {};
        for (const quarter in accountIdsByQuarter) {
          for (const accountId of accountIdsByQuarter[quarter]) {
            accountIdCounts[accountId] = (accountIdCounts[accountId] || 0) + 1;
          }
        }
        let maxCount = 0;
        for (const accountId in accountIdCounts) {
          if (accountIdCounts[accountId] > maxCount) {
            maxCount = accountIdCounts[accountId];
            commonAccountIds = new Set([accountId]);
          } else if (accountIdCounts[accountId] === maxCount) {
            commonAccountIds.add(accountId);
          }
        }
      }
      
      // 공통 계정 코드 중 가장 우선순위가 높은 것 선택
      let bestAccountId = null;
      let bestPriority = -1;
      for (const accountId of commonAccountIds) {
        // 우선순위 계산
        const priority = getAccountPriority(accountId, "");
        if (priority > bestPriority) {
          bestPriority = priority;
          bestAccountId = accountId;
        }
      }

      if (!bestAccountId) continue;

      // 선택된 계정 코드로 모든 분기 데이터를 추출
      revenueData[corpCode].years[year] = { accountId: bestAccountId };
      
      const quarterList = ["Q1", "H1", "Q3", "FY"];
      for (const quarter of quarterList) {
        if (!yearData[quarter]) continue;
        
        // 같은 계정 코드 중 가장 큰 매출액 선택
        let bestRevenue = null;
        for (const item of yearData[quarter]) {
          if (item.accountId === bestAccountId) {
            if (bestRevenue === null || item.revenue > bestRevenue) {
              bestRevenue = item.revenue;
            }
          }
        }
        
        if (bestRevenue !== null) {
          revenueData[corpCode].years[year][quarter] = bestRevenue;
        }
      }
    }
  }

  // 영업이익 데이터 처리
  for (const corpCode in tempOperatingIncomeData) {
    const corpData = tempOperatingIncomeData[corpCode];
    operatingIncomeData[corpCode] = {
      companyName: corpData.companyName,
      years: {},
    };

    for (const year in corpData.years) {
      const yearData = corpData.years[year];
      operatingIncomeData[corpCode].years[year] = {};
      
      const quarterList = ["Q1", "H1", "Q3", "FY"];
      for (const quarter of quarterList) {
        if (!yearData[quarter] || yearData[quarter].length === 0) continue;
        
        // 가장 큰 절댓값의 영업이익 선택
        let bestIncome = null;
        for (const item of yearData[quarter]) {
          if (bestIncome === null || Math.abs(item.income) > Math.abs(bestIncome)) {
            bestIncome = item.income;
          }
        }
        
        if (bestIncome !== null) {
          operatingIncomeData[corpCode].years[year][quarter] = bestIncome;
        }
      }
    }
  }

  // Q2, Q4 계산 (H1 - Q1, FY - Q3)
  for (const corpCode in revenueData) {
    for (const year in revenueData[corpCode].years) {
      const yearData = revenueData[corpCode].years[year];
      if (yearData.H1 && yearData.Q1) {
        const calculatedQ2 = yearData.H1 - yearData.Q1;
        // Q2가 0이거나 음수인 경우는 데이터 추출 오류로 간주 (null 처리)
        if (calculatedQ2 > 0) {
          yearData.Q2 = calculatedQ2;
        } else {
          console.warn(`⚠️  ${corpCode} ${year}년: Q2 계산 오류 (H1=${yearData.H1}, Q1=${yearData.Q1}, Q2=${calculatedQ2})`);
          yearData.Q2 = null;
        }
      }
      if (yearData.FY && yearData.Q3) {
        const calculatedQ4 = yearData.FY - yearData.Q3;
        // Q4가 0이거나 음수인 경우는 데이터 추출 오류로 간주 (null 처리)
        if (calculatedQ4 > 0) {
          yearData.Q4 = calculatedQ4;
        } else {
          console.warn(`⚠️  ${corpCode} ${year}년: Q4 계산 오류 (FY=${yearData.FY}, Q3=${yearData.Q3}, Q4=${calculatedQ4})`);
          yearData.Q4 = null;
        }
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
        Q1: yearData.Q1 !== undefined ? yearData.Q1 : null,
        Q2: yearData.Q2 !== undefined ? yearData.Q2 : null,
        Q3: yearData.Q3 !== undefined ? yearData.Q3 : null,
        Q4: yearData.Q4 !== undefined ? yearData.Q4 : null,
        H1: yearData.H1 !== undefined ? yearData.H1 : null,
        FY: yearData.FY !== undefined ? yearData.FY : null,
      };
      
      // 영업이익 추가 (영업이익은 음수일 수 있으므로 조건 없이 계산)
      if (operatingIncomeData[corpCode] && operatingIncomeData[corpCode].years[year]) {
        const oiYearData = operatingIncomeData[corpCode].years[year];
        finalData[corpCode].operatingIncome = finalData[corpCode].operatingIncome || {};
        finalData[corpCode].operatingIncome[year] = {
          Q1: oiYearData.Q1 !== undefined ? oiYearData.Q1 : null,
          Q2: oiYearData.H1 !== undefined && oiYearData.Q1 !== undefined ? oiYearData.H1 - oiYearData.Q1 : null,
          Q3: oiYearData.Q3 !== undefined ? oiYearData.Q3 : null,
          Q4: oiYearData.FY !== undefined && oiYearData.Q3 !== undefined ? oiYearData.FY - oiYearData.Q3 : null,
          H1: oiYearData.H1 !== undefined ? oiYearData.H1 : null,
          FY: oiYearData.FY !== undefined ? oiYearData.FY : null,
        };
      }
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
