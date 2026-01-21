import { NextResponse } from "next/server";
import { getFullReport } from "@/lib/report-server";

const reportCacheTtlMs = 30 * 60 * 1000;
const reportCache = new Map<
  string,
  { expiresAt: number; payload: unknown }
>();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawSymbol = searchParams.get("symbol")?.trim() || "삼성전자";
  
  const cacheKey = `report:${rawSymbol}`;
  const cached = reportCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.payload);
  }

  try {
    const timeoutMs = 8000;
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), timeoutMs)
    );
    const result = await Promise.race([
      getFullReport(rawSymbol),
      timeoutPromise,
    ]);
    if (!result) {
      return NextResponse.json(
        { ok: false, errorReason: "서버 응답이 지연되고 있습니다." },
        { status: 504 }
      );
    }
    
    // Transform error messages for consistency with existing UI
    let errorReason = null;
    if (!result.aiReady) {
      if (result.errorReason?.includes("GEMINI_API_KEY")) {
        errorReason = "Gemini API 키가 없습니다.";
      } else if (result.errorReason?.includes("(429)")) {
        errorReason = "AI 사용량 초과입니다.";
      } else {
        errorReason = "AI 진단을 생성하지 못했습니다.";
      }
    }

    const payload = {
      ...result,
      errorReason
    };

    if (payload.aiReady) {
      reportCache.set(cacheKey, {
        expiresAt: Date.now() + reportCacheTtlMs,
        payload,
      });
    }

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json({ 
      ok: false, 
      errorReason: "서버 오류가 발생했습니다." 
    }, { status: 500 });
  }
}
