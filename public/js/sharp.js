/* Screen pictures (160×80 pixel art) drawn sharp at any size.
   Shown with CSS "pixelated" at a size that is not a whole multiple (1.4×, 1.875×… on most screens and Windows scaling),
   their pixels come out unequal and the picture looks broken; smoothed, it looks blurred. Here a canvas is sized to its
   real screen pixels, the picture is first enlarged by a whole number with no smoothing (every pixel the same size),
   then brought down to the exact size with high-quality smoothing: sharp edges, equal pixels. */
let step = null;   // the whole-number enlargement, made once (not at load: the tests run without a page)

const sizeOf = (source) => ({
  width: source.displayWidth ?? source.naturalWidth ?? source.width,
  height: source.displayHeight ?? source.naturalHeight ?? source.height,
});

/* Draws `source` (canvas, image, ImageBitmap, VideoFrame) into `canvas`, whole and centred. False when the canvas is not
   on screen (no size): nothing drawn. */
export const drawSharp = (canvas, source) => {
  const box = canvas.getBoundingClientRect();
  if (!box.width || !box.height) { return false; }
  const ratio = window.devicePixelRatio || 1;
  // the drawing area inside the border (a border would otherwise squeeze the picture a little)
  const width = Math.max(1, Math.round((box.width - (canvas.offsetWidth - canvas.clientWidth)) * ratio));
  const height = Math.max(1, Math.round((box.height - (canvas.offsetHeight - canvas.clientHeight)) * ratio));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, width, height);
  const { width: sw, height: sh } = sizeOf(source);
  if (!sw || !sh) { return true; }
  const scale = Math.min(width / sw, height / sh);
  const dw = Math.round(sw * scale);
  const dh = Math.round(sh * scale);
  const x = Math.round((width - dw) / 2);
  const y = Math.round((height - dh) / 2);
  const whole = Math.max(1, Math.ceil(scale - 1e-6));
  if (scale >= 1 && Math.abs(scale - whole) < 1e-6) {   // a whole multiple already: straight, no smoothing
    context.imageSmoothingEnabled = false;
    context.drawImage(source, x, y, dw, dh);
    return true;
  }
  let from = source;
  if (scale > 1) {
    step ??= document.createElement("canvas");
    step.width = sw * whole;
    step.height = sh * whole;
    const big = step.getContext("2d");
    big.imageSmoothingEnabled = false;
    big.drawImage(source, 0, 0, step.width, step.height);
    from = step;
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(from, x, y, dw, dh);
  return true;
};

/* Redraws a canvas when its size on screen changes (window resized, panel opened, zoom). */
const redraws = new WeakMap();
const watcher = typeof ResizeObserver === "function"
  ? new ResizeObserver((entries) => { for (const entry of entries) { redraws.get(entry.target)?.(); } })
  : null;
export const keepSharp = (canvas, redraw) => {
  redraws.set(canvas, redraw);
  watcher?.observe(canvas);
};
export const stopSharp = (canvas) => { redraws.delete(canvas); watcher?.unobserve(canvas); };
