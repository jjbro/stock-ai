import { NextResponse } from "next/server";
import { getMarketReport } from "@/lib/report-server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawSymbol = searchParams.get("symbol")?.trim() || "하이닉스";

  try {
    const result = await getMarketReport(rawSymbol);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { ok: false, errorReason: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
