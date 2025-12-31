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
          bg: '#111111ff',
          sidebar: '#252526',
          activityBar: '#060606a9',
          statusBar: 'rgba(13, 188, 121, 0.82)',
          border: '#3c3c3c',
          text: '#ffffffff',
          textMuted: '#969696',
          hover: '#2a2d2e',
          selection: 'rgb(13, 188, 121)',
          accent: 'rgb(13, 188, 121)',
        }
      },
      fontFamily: {
        mono: ['Monaco', 'Menlo', 'Ubuntu Mono', 'monospace'],
      }
    },
  },
  plugins: [],
}