import React from 'react';

export interface BrandLogoProps {
  /** Mark height in px. The 65x42 canvas keeps its aspect ratio (width = size * 65 / 42). */
  size?: number;
  withWordmark?: boolean;
  /** `true` = "Restoration Document Suite", a string overrides it, `false` hides it. */
  sublabel?: string | boolean;
  /** `light` for dark neutral surfaces (plus + wordmark go white; the bar stays red). */
  tone?: 'dark' | 'light';
  className?: string;
}

/** Brand red — same value as `--color-brand` in src/index.css. */
const BRAND_RED = '#DC2626';
/** Logo ink — same value as `--color-ink`. */
const LOGO_INK = '#1A1A1A';
/** The plus is white ONLY on dark neutral surfaces — never white-on-red. */
const LOGO_WHITE = '#FFFFFF';

/**
 * Hays + Sons lockup: the "H+" mark plus the optional `Hays+Sons` wordmark.
 *
 * Exact geometry on the 65x42 canvas (bar and plus share height 42 and stroke 14):
 *   - red bar       rect x=0  y=0  w=14 h=42   fill #DC2626
 *   - plus stem     rect x=36 y=0  w=14 h=42   fill ink (white on dark surfaces)
 *   - plus crossbar rect x=14 y=14 w=51 h=14   fill ink (white on dark surfaces)
 *
 * The crossbar starts at exactly x=14 — flush into the bar, no gap; separate them
 * and the "H" reading is lost. The mark is NEVER wrapped in a rounded square and
 * NEVER inverted to white-on-red. The wordmark has no spaces around the `+`.
 */
export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 32,
  withWordmark = true,
  sublabel = true,
  tone = 'dark',
  className,
}) => {
  const plusFill = tone === 'light' ? LOGO_WHITE : LOGO_INK;
  const sublabelText =
    typeof sublabel === 'string'
      ? sublabel
      : sublabel
        ? 'Restoration Document Suite'
        : null;

  return (
    <span
      className={['inline-flex items-center gap-2.5 shrink-0', className]
        .filter(Boolean)
        .join(' ')}
    >
      {/* The mark — bare geometry, no container, no rounded square. */}
      <svg
        viewBox="0 0 65 42"
        height={size}
        width={(size * 65) / 42}
        aria-hidden="true"
        focusable="false"
        className="shrink-0"
      >
        {/* Red bar */}
        <rect x="0" y="0" width="14" height="42" fill={BRAND_RED} />
        {/* Plus stem — same height and stroke width as the bar */}
        <rect x="36" y="0" width="14" height="42" fill={plusFill} />
        {/* Crossbar — starts at x=14, flush into the bar (no gap) */}
        <rect x="14" y="14" width="51" height="14" fill={plusFill} />
      </svg>

      {withWordmark && (
        <span className="flex flex-col leading-none">
          <span
            className={`font-extrabold tracking-tight leading-none ${
              tone === 'light' ? 'text-white' : 'text-slate-900'
            }`}
            style={{ fontSize: size * 0.44 }}
          >
            Hays+Sons
          </span>
          {sublabelText && (
            <span
              className={`font-medium leading-tight ${
                tone === 'light' ? 'text-slate-300' : 'text-slate-500'
              }`}
              style={{ fontSize: size * 0.31 }}
            >
              {sublabelText}
            </span>
          )}
        </span>
      )}
    </span>
  );
};
