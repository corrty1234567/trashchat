import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#202729",
        paper: "#f4f6f7",
        line: "#e3e8e8",
        brand: "#18765f"
      },
      boxShadow: {
        soft: "0 18px 60px rgba(17, 24, 39, 0.12)"
      }
    }
  },
  plugins: []
};

export default config;
