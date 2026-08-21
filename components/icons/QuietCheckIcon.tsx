/* A small, calm affirming mark for the ASSISTED continuation beat — never a
 * star, never sparkles, never a "you won" shape (see app/read/page.tsx's
 * celebrateAndAdvance: an assisted rung-3 continuation must never read as a
 * lesser/failed version of a real success). Leaf-colored, no bounce/pop —
 * just present, so a child who can't yet read "On we go!" still gets a
 * wordless, unmistakably warm (not red, not blank) signal that the story is
 * continuing normally. */
export function QuietCheckIcon({
  size = 30,
  color = 'var(--leaf)',
  className,
}: {
  size?: number;
  color?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" fill={color} fillOpacity="0.16" />
      <path
        d="M7.5 12.2L10.3 15L16.5 8.8"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
