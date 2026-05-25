/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./hooks/**/*.{js,jsx,ts,tsx}",
    "./store/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Poppins_400Regular", "Poppins", "sans-serif"],
        poppins: ["Poppins_400Regular", "Poppins", "sans-serif"],
        "poppins-medium": ["Poppins_500Medium", "Poppins", "sans-serif"],
        "poppins-semibold": ["Poppins_600SemiBold", "Poppins", "sans-serif"],
        "poppins-bold": ["Poppins_700Bold", "Poppins", "sans-serif"],
        "poppins-extrabold": ["Poppins_800ExtraBold", "Poppins", "sans-serif"],
        "poppins-black": ["Poppins_900Black", "Poppins", "sans-serif"],
      },
    },
  },
  plugins: [
    ({ addUtilities }) => {
      addUtilities({
        ".font-thin": { fontFamily: "Poppins_400Regular" },
        ".font-extralight": { fontFamily: "Poppins_400Regular" },
        ".font-light": { fontFamily: "Poppins_400Regular" },
        ".font-normal": { fontFamily: "Poppins_400Regular" },
        ".font-medium": { fontFamily: "Poppins_500Medium" },
        ".font-semibold": { fontFamily: "Poppins_600SemiBold" },
        ".font-bold": { fontFamily: "Poppins_700Bold" },
        ".font-extrabold": { fontFamily: "Poppins_800ExtraBold" },
        ".font-black": { fontFamily: "Poppins_900Black" },
      });
    },
  ],
}