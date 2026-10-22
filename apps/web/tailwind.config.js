/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'] },
      colors: {
        bg: v('bg'), surface: v('surface'), 'surface-2': v('surface-2'), line: v('line'),
        ink: v('ink'), muted: v('muted'),
        brand: { DEFAULT: v('brand'), soft: v('brand-soft'), ink: v('brand-ink') },
        ok: v('ok'), warn: v('warn'), bad: v('bad'), info: v('info'),
      },
      boxShadow: {
        card: '0 1px 2px rgb(15 23 42 / 0.04), 0 4px 16px -4px rgb(15 23 42 / 0.08)',
        lift: '0 12px 32px -8px rgb(79 70 229 / 0.25)',
      },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        blob: { '0%,100%': { transform: 'translate(0,0) scale(1)' }, '33%': { transform: 'translate(30px,-40px) scale(1.1)' }, '66%': { transform: 'translate(-20px,20px) scale(0.95)' } },
      },
      animation: { shimmer: 'shimmer 1.4s infinite', blob: 'blob 14s ease-in-out infinite' },
    },
  },
  plugins: [],
};
