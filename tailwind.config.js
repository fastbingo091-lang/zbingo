/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./admin-ui/index.html', './admin-ui/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#090d18',
        panel: '#111827',
        gold: '#facc15',
        honey: '#f59e0b',
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(250,204,21,.14), 0 18px 60px rgba(0,0,0,.35)',
      },
    },
  },
  plugins: [],
};
