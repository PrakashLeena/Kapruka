/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        cream: {
          50: "#FAF3E7",
          100: "#F2E9D8",
          200: "#E8DBC2",
        },
        charcoal: "#2B2620",
        terracotta: {
          DEFAULT: "#C75D3D",
          dark: "#A6492F",
          light: "#E8B6A4",
        },
        teal: {
          DEFAULT: "#1B4D43",
          light: "#2E6F61",
          50: "#E7EFEC",
        },
        gold: "#D89B3C",
      },
      fontFamily: {
        display: ["Fraunces", "serif"],
        sans: ["'Plus Jakarta Sans'", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
