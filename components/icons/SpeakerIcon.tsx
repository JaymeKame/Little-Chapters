/* Little Chapters-designed speech/listen-aloud icon — replaces the old
 * /icons/speaker-audio.png, which was an exported Unicode 🔊 emoji baked
 * into a non-square (211x163) raster that got squashed whenever CSS forced
 * it into a square box (see .lc-audio-icon). Inline SVG on a square viewBox
 * scales losslessly at any size/DPI, has no network request to fail, and
 * carries no background of its own — safe to drop into any circular button
 * without ever doubling up on a background ring. Color matches the existing
 * "the app is talking" language (sky/blue), distinct from the mic's green. */
export function SpeakerIcon({
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
      <path
        d="M3.5 9.75C3.5 8.784 4.284 8 5.25 8H7.4L11.1 5.12C11.73 4.63 12.65 5.08 12.65 5.88V18.12C12.65 18.92 11.73 19.37 11.1 18.88L7.4 16H5.25C4.284 16 3.5 15.216 3.5 14.25V9.75Z"
        fill={color}
      />
      <path
        d="M15.7 8.6C16.95 9.9 16.95 14.1 15.7 15.4"
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M18.1 6.3C20.35 8.7 20.35 15.3 18.1 17.7"
        stroke={color}
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
