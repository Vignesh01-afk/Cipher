import defaultTheme from 'tailwindcss/defaultTheme';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', ...defaultTheme.fontFamily.sans],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      colors: {
        // CipherNote "aurora" theme (per the reference mockups):
        // a blue -> magenta gradient brand over periwinkle light surfaces and
        // deep indigo-navy dark surfaces. The codebase was written against the
        // warm `orange` accent + `stone` neutrals, so remapping those two
        // palettes rethemes every screen at once.
        //   orange -> brand blue-violet (accent text/borders/icons)
        //   stone  -> periwinkle-tinted neutrals (light + dark surfaces)
        orange: {
          50: '#EEF2FF',
          100: '#DFE6FF',
          200: '#C6D2FF',
          300: '#A3B4FF',
          400: '#7D8FFF',
          500: '#4A6CF7',
          600: '#3D55E0',
          700: '#3447C0',
          800: '#2C3A9E',
          900: '#28327E',
          950: '#1A2050',
        },
        stone: {
          50: '#F5F7FE',
          100: '#EDF1FC',
          200: '#DFE5F7',
          300: '#C8D0EE',
          400: '#8E97C4',
          500: '#6A74A3',
          600: '#565F8C',
          700: '#444C74',
          800: '#2A3154',
          900: '#171C38',
          950: '#0A0E23',
        },
        // Primary brand accent (indigo #6366F1 core). The codebase uses both
        // `bg-brand` / `text-brand` and `bg-brand-500` / `from-brand-500`, so a
        // DEFAULT value is required alongside the numbered scale.
        brand: {
          DEFAULT: '#6366F1',
          50: '#EEF1FF',
          100: '#E0E5FF',
          200: '#C7CEFF',
          300: '#A5AEFF',
          400: '#8189FB',
          500: '#6366F1',
          600: '#4F46E5',
          700: '#4338CA',
          800: '#3730A3',
          900: '#312E81',
          950: '#1E1B4B',
        },
        // Brand gradient endpoints, usable directly (e.g. bg-aurora-from).
        aurora: {
          from: '#4A6CF7',
          via: '#8B5CF6',
          to: '#D946EF',
        },
      },
      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.97)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'aurora-drift': {
          '0%, 100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '50%': { transform: 'translate3d(0,-3%,0) scale(1.05)' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 180ms ease-out',
        'fade-in': 'fade-in 160ms ease-out',
        'scale-in': 'scale-in 160ms ease-out',
        'aurora-drift': 'aurora-drift 14s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
