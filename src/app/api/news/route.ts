import { NextResponse } from "next/server";
import { getNewsReport } from "@/lib/report-server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawSymbol = searchParams.get("symbol")?.trim() || "삼성전자";

  try {
    const result = await getNewsReport(rawSymbol);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { ok: false, errorReason: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
