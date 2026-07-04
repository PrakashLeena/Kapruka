/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        cream: {
          50: "#FAF9FC", // White background with subtle purple tint for depth
          100: "#F1EFF7", // Off-white for sidebar and card backgrounds
          200: "#E3DFED", // Soft borders
        },
        charcoal: "#1F1A2B", // Deep dark purple-tinted charcoal for text
        terracotta: {
          DEFAULT: "#402970", // User requested deep purple: rgb(64, 41, 112)
          dark: "#301B5B", // Darker purple for hovers
          light: "#D0C9E3", // Soft purple accent
        },
        teal: {
          DEFAULT: "#402970", // Deep purple brand color
          light: "#533794", // Medium purple hover
          50: "#F0EEF5", // Light purple-grey
        },
        gold: "#FAE555", // User requested bright yellow: rgb(250, 229, 85)
      },
      fontFamily: {
        display: ["'Poppins'", "'Roboto'", "'Segoe UI'", "Helvetica", "Arial", "sans-serif"],
        sans: ["'Poppins'", "'Roboto'", "'Segoe UI'", "Helvetica", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};
