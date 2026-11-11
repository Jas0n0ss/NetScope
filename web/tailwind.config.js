/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        void: 'rgb(var(--c-void) / <alpha-value>)',
        panel: 'rgb(var(--c-panel) / <alpha-value>)',
        raise: 'rgb(var(--c-raise) / <alpha-value>)',
        inset: 'rgb(var(--c-inset) / <alpha-value>)',
        line: 'rgb(var(--c-line) / <alpha-value>)',
        edge: 'rgb(var(--c-edge) / <alpha-value>)',
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        muted: 'rgb(var(--c-muted) / <alpha-value>)',
        dim: 'rgb(var(--c-dim) / <alpha-value>)',
        acid: 'rgb(var(--c-acid) / <alpha-value>)',
        teal: 'rgb(var(--c-teal) / <alpha-value>)',
        amber: 'rgb(var(--c-amber) / <alpha-value>)',
        danger: 'rgb(var(--c-danger) / <alpha-value>)',
        sky: 'rgb(var(--c-sky) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['InterVariable', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains MonoVariable', 'JetBrains Mono', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      letterSpacing: {
        micro: '0.18em',
      },
      boxShadow: {
        glow: '0 0 0 1px rgb(var(--c-acid) / 0.25), 0 0 24px -8px rgb(var(--c-acid) / 0.35)',
        inset: 'inset 0 1px 0 rgb(var(--c-wash) / 0.03)',
      },
      keyframes: {
        pulseDot: {
          '0%,100%': { opacity: '1' },
          '50%': { opacity: '0.25' },
        },
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(400%)' },
        },
        sweep: {
          '0%': { width: '0%' },
          '100%': { width: '100%' },
        },
      },
      animation: {
        pulseDot: 'pulseDot 2.4s ease-in-out infinite',
        sweep: 'sweep 1.4s ease-out forwards',
      },
    },
  },
  plugins: [],
};
