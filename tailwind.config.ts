import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#f4f0e8",
        card: "#fffcf8",
        ink: "#1b2421",
        muted: "#3d4c46",
        line: "#e2d9cc",
        forest: {
          950: "#101916",
          900: "#17302a",
          800: "#1e3a32",
          700: "#1f6b4a",
          100: "#e7f3ec",
          50: "#f3faf6",
        },
        clay: "#b85a28",
        danger: "#8e2f2f",
        warn: "#8a5a00",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Segoe UI", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(27, 36, 33, 0.04), 0 8px 24px rgba(27, 36, 33, 0.04)",
      },
    },
  },
  plugins: [],
};

export default config;
