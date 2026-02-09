'use client';

interface RingProgressProps {
  value: number;
  goal: number;
  size?: number;
  strokeWidth?: number;
  color: string;
  trackColor?: string;
}

export function RingProgress({
  value,
  goal,
  size = 120,
  strokeWidth = 10,
  color,
  trackColor = '#e2e8f0',
}: RingProgressProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(value / goal, 1);
  const offset = circumference - progress * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        {/* Progress */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      {/* Center number */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className={`text-3xl font-bold tabular-nums ${
            value >= goal ? 'text-emerald-600' : ''
          }`}
        >
          {value}
        </span>
      </div>
    </div>
  );
}
