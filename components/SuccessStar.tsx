/* Deterministic, self-contained success star.
 *
 * Replaces public/icons/success-star.png, which was reported cropped
 * repeatedly across the ending and the mid-chapter praise beat. A raster
 * PNG in a flex/grid slot has an ambiguous bounding box: any ancestor
 * `overflow:hidden` (of which there are several on both the ending card
 * and the reading scene) can cut the render mid-glyph, and the fix cycle
 * of nudging padding/height on the container reliably breaks it somewhere
 * else. The remedy is not another positional tweak — it's an asset whose
 * bounding box is known at every size.
 *
 * This SVG has a fixed 100×100 viewBox and no negative-coordinate strokes,
 * so nothing can render outside it. Size is set via the `size` prop
 * (defaults to a comfortable 64px, matching the ending's original hero
 * feel) — CSS transforms on the wrapper animate the *rendered* pixels
 * without ever leaving the viewBox, so subsequent overflow clips are
 * impossible even mid-animation.
 *
 * Motion is a very restrained pop + soft glow, aligned with the app's
 * "gentle, not celebratory" tone; prefers-reduced-motion drops both.
 * Never uses emoji — inzone-games' emoji fallback rendered as a black
 * outline on some Android builds. */

export function SuccessStar({
  size = 64,
  className,
  glow = true,
}: {
  size?: number;
  className?: string;
  /** Soft outer glow. Off on tighter surfaces (e.g. inline praise) where
   *  the glow would collide with adjacent text. Default on. */
  glow?: boolean;
}) {
  return (
    <span
      className={`lc-success-star${glow ? ' lc-success-star--glow' : ''}${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size, display: 'inline-block', flex: '0 0 auto' }}
      aria-hidden
    >
      <svg viewBox="0 0 100 100" width={size} height={size} role="presentation" focusable="false">
        {/* Rounded, storybook-friendly 5-point star. Coordinates hand-tuned
         *  around 50,50 with a 42px outer radius / 18px inner radius so
         *  the widest extent is 92px in a 100px viewBox — 4px of internal
         *  breathing room on every side, guaranteeing no self-clipping
         *  regardless of the stroke width the browser resolves. */}
        <defs>
          <linearGradient id="lc-star-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#FFE18A" />
            <stop offset="0.55" stopColor="#F4C95D" />
            <stop offset="1" stopColor="#E5A93A" />
          </linearGradient>
        </defs>
        <path
          d="M50 8 L61 38 L92 38 L67 57 L77 88 L50 70 L23 88 L33 57 L8 38 L39 38 Z"
          fill="url(#lc-star-fill)"
          stroke="#B7842B"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {/* Small highlight — reads as a child's-book star, not a metallic
         *  achievement badge. */}
        <path
          d="M42 26 Q48 22 54 26 Q52 32 46 32 Q42 30 42 26 Z"
          fill="#FFF3C4"
          opacity="0.7"
        />
      </svg>
    </span>
  );
}
