export type Sentiment = "positive" | "negative" | "neutral";

export function getMarketSignal({
  qoq,
  yoy,
  sentiment,
}: {
  qoq: number;
  yoy: number;
  sentiment: Sentiment;
}) {
  if (qoq > 0 && yoy > 0 && sentiment === "positive") return "맑음";
  if (qoq < 0 && yoy < 0 && sentiment === "negative") return "흐림";
  return "구름";
}
