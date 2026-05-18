/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // ───── BETTHAT Holy Grail V2 — Dark Mode (canonical) ─────
        jet:       '#0A0A0C', // app background, the void
        navy:      '#1B2A4A', // elevated surfaces (used at low alpha)
        steel:     '#3A5F8A', // secondary accent, borders
        sky:       '#5B9BD5', // PRIMARY ACCENT — WIN, active, direction up
        ink:       '#E8EDF2', // primary text on dark
        muted:     '#8A93A6', // secondary text, labels, LOSS

        // PRICE-DIRECTION ONLY. Never UI chrome, never WIN/LOSS coloring,
        // never action buttons. Reserved exclusively for player price movement.
        up:        '#26D782',
        down:      '#F24236',

        // ───── Surface system ─────
        surface: {
          DEFAULT: '#141416', // card surface
          raised:  '#1B1C20', // slightly elevated
          input:   '#0D0D10', // carved/inset input field
          border:  'rgba(255,255,255,0.08)',
        },

        // ───── Legacy tokens (kept for not-yet-redesigned screens) ─────
        // These are scheduled for removal once every screen is on Holy Grail tokens.
        brand: {
          DEFAULT: '#5B9BD5', // remapped to Sky Blue (was #F5A524 amber gold)
          dark:    '#3A5F8A',
          light:   '#7CB1DD',
        },
        bg: {
          DEFAULT: '#0A0A0C',
          alt:     '#141416',
        },
        text: {
          primary:   '#E8EDF2',
          secondary: '#8A93A6',
          muted:     '#5C6473',
        },
        // Reserved (price direction). Kept for compatibility with utils.ts
        priceUp:   '#26D782',
        priceDown: '#F24236',
        // Semantic state (used outside of price-direction context).
        // Holy Grail discipline: WIN is sky blue, LOSS is muted gray, not green/red.
        win:     '#5B9BD5',
        loss:    '#3a3a3c',
        warning: '#E0A227',
        info:    '#5B9BD5',
        live:    '#5B9BD5',
        brandTint:   'rgba(91,155,213,0.10)',
        winTint:     'rgba(91,155,213,0.10)',
        lossTint:    'rgba(58,58,60,0.20)',
        warningTint: '#1F1407',
        tier: {
          budget:    '#6B7280',
          mid:       '#3B82F6',
          star:      '#A855F7',
          superstar: '#EAB308',
        },
        rank: {
          Bronze:   '#CD7F32',
          Silver:   '#C0C0C0',
          Gold:     '#FFD700',
          Platinum: '#E5E4E2',
          Diamond:  '#B9F2FF',
        },
      },
      fontFamily: {
        // ───── Holy Grail V2 type stack ─────
        // DM Sans — every UI string, label, body paragraph
        sans:        ['DMSans_400Regular', 'System'],
        sansLight:   ['DMSans_300Light', 'System'],
        sansMedium:  ['DMSans_500Medium', 'System'],
        sansBold:    ['DMSans_600SemiBold', 'System'],
        // DM Serif Display — headlines only
        serif:       ['DMSerifDisplay_400Regular', 'Times New Roman'],
        serifItalic: ['DMSerifDisplay_400Regular_Italic', 'Times New Roman'],
        // IBM Plex Mono — every number, ticker, price, percentage, timestamp
        mono:        ['IBMPlexMono_400Regular', 'Courier'],
        monoMedium:  ['IBMPlexMono_500Medium', 'Courier'],
        monoBold:    ['IBMPlexMono_600SemiBold', 'Courier'],
        // VT323 — LED scoreboard / pixel font. RESERVED for hero resolution
        // moments only (Splash tickers, Live Game Board score banner, Match
        // Found wager hero, Game Result WIN/LOSS + final scores). Never for
        // working numerics — Plex Mono handles those.
        hero:        ['VT323_400Regular', 'Courier'],
      },
      letterSpacing: {
        ticker: '0.04em',
        eyebrow: '0.18em',
        chip: '0.08em',
      },
      borderRadius: {
        input: '14px',
        card:  '16px',
      },
    },
  },
  plugins: [],
};
