/** @type {import('tailwindcss').Config} */
// V3-8 (LLD_v3 §6, HLD_v3 ADR-18): theme extension mirroring
// design-system/tokens.css's custom properties, so existing and new
// components can move onto Tailwind utilities incrementally without a
// visual break. Component-specific quirks that don't fit utility classes
// cleanly stay as plain CSS (design-system.css, App.css), not fought into
// Tailwind — see the plan's "Resolved decisions #1".
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ds: {
          bg: "#f4f5f7",
          surface: "#ffffff",
          border: "#e3e5ea",
          text: "#16181d",
          "text-muted": "#676c76",
          accent: "#2563eb",
          "accent-contrast": "#ffffff",
        },
        sidebar: {
          bg: "#14161c",
          text: "#e7e8ea",
          "text-muted": "#9599a3",
          "active-bg": "#23262f",
        },
        status: {
          "neutral-bg": "#eceef1",
          "neutral-fg": "#40454f",
          "info-bg": "#dbeafe",
          "info-fg": "#1d4ed8",
          "success-bg": "#dcfce7",
          "success-fg": "#15803d",
          "warning-bg": "#fef3c7",
          "warning-fg": "#92400e",
          "danger-bg": "#fee2e2",
          "danger-fg": "#b91c1c",
        },
      },
      borderRadius: {
        "ds-sm": "4px",
        "ds-md": "8px",
        "ds-lg": "12px",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        blob: {
          "0%, 100%": { transform: "translate(0px, 0px) scale(1)" },
          "33%": { transform: "translate(24px, -32px) scale(1.08)" },
          "66%": { transform: "translate(-18px, 18px) scale(0.94)" },
        },
        // W18 (HLD_v4 ADR-24): groundwork for a v5 animation pass — a
        // smaller, snappier mount than fade-in-up, for compact repeated
        // elements (stat tiles, list rows) rather than whole-page sections.
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.6s ease-out both",
        "fade-in-up": "fade-in-up 0.7s ease-out both",
        blob: "blob 12s infinite ease-in-out",
        "scale-in": "scale-in 0.35s ease-out both",
      },
    },
  },
  plugins: [],
};
