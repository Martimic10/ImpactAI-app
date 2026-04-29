/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        'green-primary': '#2E7D32',
        'green-light': '#66BB6A',
        'green-pale': '#E8F5E9',
      },
    },
  },
  plugins: [],
};
