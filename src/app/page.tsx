import HomeClient from "@/components/HomeClient";
import { getKrxSymbols } from "@/lib/krx";

export const dynamic = "force-dynamic";

export default async function Home() {
  // Keep initial load lightweight; client will fetch report data.
  const initialSymbols = await getKrxSymbols();

  return (
    <HomeClient initialSymbols={initialSymbols} />
  );
}
