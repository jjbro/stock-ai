import { NextResponse } from "next/server";
import { getKrxSymbols } from "@/lib/krx";
import { fallbackSymbolDirectory } from "@/lib/symbols";

export async function GET() {
  const symbols = await getKrxSymbols();
  const data = symbols.length ? symbols : fallbackSymbolDirectory;

  return NextResponse.json({
    ok: true,
    count: data.length,
    symbols: data,
  });
}
