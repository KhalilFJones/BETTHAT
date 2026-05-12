/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // BETTHAT brand palette — dark sports theme
        brand: {
          DEFAULT: '#F59E0B', // amber gold — primary CTA
          dark:    '#D97706',
          light:   '#FCD34D',
        },
        surface: {
          DEFAULT: '#141414', // main card background
          raised:  '#1E1E1E', // elevated card
          overlay: '#242424', // modal / sheet
          border:  '#2E2E2E', // subtle dividers
        },
        bg: {
          DEFAULT: '#0a0a0a', // app background
          alt:     '#111111',
        },
        text: {
          primary:   '#FFFFFF',
          secondary: '#A1A1AA', // zinc-400
          muted:     '#71717A', // zinc-500
        },
        win:  '#22C55E', // green-500
        loss: '#EF4444', // red-500
        live: '#F59E0B', // amber — live indicator
        tier: {
          budget:    '#6B7280', // gray
          mid:       '#3B82F6', // blue
          star:      '#A855F7', // purple
          superstar: '#F59E0B', // gold
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
        sans:  ['Inter_400Regular', 'System'],
        medium:['Inter_500Medium', 'System'],
        bold:  ['Inter_700Bold', 'System'],
        black: ['Inter_900Black', 'System'],
      },
    },
  },
  plugins: [],
};
