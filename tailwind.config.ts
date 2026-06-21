import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#07090f",
        accent: "#00c8f0",
        surface: "#0d1117",
        border: "#1e2a3a",
        muted: "#8b949e",
      },
    },
  },
  plugins: [],
};
export default config;
