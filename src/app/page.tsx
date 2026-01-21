import HomeClient from "@/components/HomeClient";
import { getFullReport } from "@/lib/report-server";
import { getKrxSymbols } from "@/lib/krx";

export const dynamic = "force-dynamic";

export default async function Home() {
  // Fetch initial data on the server to improve LCP
  const [initialReportResult, initialSymbols] = await Promise.all([
    getFullReport("005930.KS"),
    getKrxSymbols(),
  ]);

  return (
    <HomeClient 
      initialReport={initialReportResult} 
      initialSymbols={initialSymbols} 
    />
  );
}
