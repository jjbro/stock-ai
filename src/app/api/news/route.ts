import { NextResponse } from "next/server";
import { getNewsReport } from "@/lib/report-server";

const ONE_DAY_SECONDS = 60 * 60 * 24;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawSymbol = searchParams.get("symbol")?.trim() || "하이닉스";

  try {
    const result = await getNewsReport(rawSymbol);
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": `s-maxage=${ONE_DAY_SECONDS}, stale-while-revalidate=${ONE_DAY_SECONDS / 2}`,
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, errorReason: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
