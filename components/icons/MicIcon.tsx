/* Little Chapters-designed microphone/your-turn icon — replaces the old
 * /icons/mic-listening.png (an exported Unicode 🎙️ emoji, same non-square
 * distortion problem as SpeakerIcon). Same square-viewBox SVG approach:
 * crisp at any size/DPI, no asset request, no background of its own. Color
 * matches the existing "the app is listening" language (leaf green),
 * distinct from the speaker's blue. */
export function MicIcon({
  size = 24,
  color = 'currentColor',
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
      <rect x="9" y="3" width="6" height="11" rx="3" fill={color} />
      <path
        d="M5.5 11a6.5 6.5 0 0013 0"
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path d="M12 17.5v3" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M8.5 20.5h7" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
