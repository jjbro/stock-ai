import { NextResponse } from "next/server";
import { getAiReport } from "@/lib/report-server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawSymbol = searchParams.get("symbol")?.trim() || "삼성전자";

  try {
    const result = await getAiReport(rawSymbol);
    let errorReason = result.errorReason ?? null;
    if (errorReason?.includes("GEMINI_API_KEY")) {
      errorReason = "Gemini API 키가 없습니다.";
    } else if (errorReason?.includes("(429)")) {
      errorReason = "AI 사용량 초과입니다.";
    } else if (errorReason?.includes("timeout")) {
      errorReason = "서버 응답이 지연되고 있습니다.";
    } else if (errorReason) {
      errorReason = "AI 진단을 생성하지 못했습니다.";
    }

    return NextResponse.json({
      ...result,
      errorReason,
    });
  } catch {
    return NextResponse.json(
      { ok: false, errorReason: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
