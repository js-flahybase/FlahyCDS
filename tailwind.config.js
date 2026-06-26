/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#102033',
        mist: '#5f7084',
        line: '#d8e3f0',
        brand: '#0f6cbd',
        brandDeep: '#0a4f8a',
        mint: '#12b886'
      },
      boxShadow: {
        panel: '0 18px 48px rgba(15, 47, 84, 0.12)'
      }
    }
  },
  plugins: []
};
