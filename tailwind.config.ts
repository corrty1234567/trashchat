import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#26364b",
        paper: "#f5f6f8",
        line: "#e7ebf2",
        brand: "#1769ff"
      },
      boxShadow: {
        soft: "0 18px 60px rgba(17, 24, 39, 0.12)"
      }
    }
  },
  plugins: []
};

export default config;
