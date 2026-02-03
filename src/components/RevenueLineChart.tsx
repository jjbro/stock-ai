type Point = {
  label: string;
  value: number;
};

type Series = {
  year: number;
  points: Point[];
};

type Props = {
  currentYear: Series;
  previousYear: Series;
};

function buildPath(points: { x: number; y: number }[]) {
  if (!points.length) return "";
  return points
    .map((point, index) =>
      index === 0 ? `M ${point.x} ${point.y}` : `L ${point.x} ${point.y}`
    )
    .join(" ");
}

export default function RevenueLineChart({ currentYear, previousYear }: Props) {
  const width = 320;
  const height = 140;
  const paddingX = 24;
  const paddingY = 16;
  const labelWidth = 34;

  const allValues = [
    ...currentYear.points.map((point) => point.value),
    ...previousYear.points.map((point) => point.value),
  ];
  const maxValue = Math.max(...allValues, 1);

  function formatAmount(value: number) {
    // value is in 억 단위
    if (value >= 10000) return `${(value / 10000).toFixed(1)}조`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}천억`;
    return `${value.toFixed(0)}억`;
  }

  const toCoords = (points: Point[]) =>
    points.map((point, index) => {
      const x =
        paddingX +
        (index / Math.max(points.length - 1, 1)) *
          (width - paddingX * 2 - labelWidth);
      const y =
        height -
        paddingY -
        (point.value / maxValue) * (height - paddingY * 2);
      return { x, y };
    });

  const currentCoords = toCoords(currentYear.points);
  const prevCoords = toCoords(previousYear.points);

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-semibold text-zinc-300">
          {previousYear.year}(점선)
        </span>
        <span className="font-semibold text-sky-300">
          {currentYear.year}(실선)
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="mt-3 h-36 w-full"
        role="img"
        aria-label="영업이익 비교 라인 차트"
      >
        <path
          d={buildPath(prevCoords)}
          fill="none"
          stroke="#a1a1aa"
          strokeWidth="2"
          strokeDasharray="4 4"
        />
        <path
          d={buildPath(currentCoords)}
          fill="none"
          stroke="#38bdf8"
          strokeWidth="2.5"
        />
        {currentCoords.map((point) => (
          <circle
            key={`c-${point.x}-${point.y}`}
            cx={point.x}
            cy={point.y}
            r="3"
            fill="#38bdf8"
          />
        ))}
        {prevCoords.map((point) => (
          <circle
            key={`p-${point.x}-${point.y}`}
            cx={point.x}
            cy={point.y}
            r="2.5"
            fill="#a1a1aa"
          />
        ))}
        <g>
          {[1, 0.5, 0].map((ratio) => {
            const value = maxValue * ratio;
            const y =
              height -
              paddingY -
              ratio * (height - paddingY * 2);
            return (
              <text
                key={`label-${ratio}`}
                x={width - labelWidth + 2}
                y={y + 4}
                fontSize="10"
                fill="#71717a"
              >
                {formatAmount(value)}
              </text>
            );
          })}
        </g>
      </svg>
      <div className="mt-2 grid grid-cols-4 gap-2 text-center text-[11px] text-zinc-500">
        {currentYear.points.map((point) => (
          <span key={point.label}>{point.label}</span>
        ))}
      </div>
    </div>
  );
}
