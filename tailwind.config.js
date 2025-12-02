/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        vscode: {
          bg: '#1e1e1e',
          sidebar: '#252526',
          activityBar: '#2c2c2c',
          statusBar: '#007acc',
          border: '#3c3c3c',
          text: '#cccccc',
          textMuted: '#969696',
          hover: '#2a2d2e',
          selection: '#264f78',
          accent: '#007acc',
        }
      },
      fontFamily: {
        mono: ['Monaco', 'Menlo', 'Ubuntu Mono', 'monospace'],
      }
    },
  },
  plugins: [],
}