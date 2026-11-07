/* The two web fonts (Inter, Space Grotesk) are added here, not with a <link> in the page: a stylesheet put in by a
   script does not hold back the first paint, so the page shows at once in the system font and swaps when they arrive.
   (A <link onload> trick would need inline script, which the Content-Security-Policy does not allow.) */
const fonts = document.createElement("link");
fonts.rel = "stylesheet";
fonts.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;700&display=swap";
document.head.append(fonts);
