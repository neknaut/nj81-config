/* Screen pictures (160×80 pixel art) drawn sharp at any size.
   Shown with CSS "pixelated" at a size that is not a whole multiple (1.4×, 1.875×… on most screens and Windows scaling),
   their pixels come out unequal and the picture looks broken; smoothed, it looks blurred. Here a canvas is sized to its
   real screen pixels, the picture is first enlarged by a whole number with no smoothing (every pixel the same size),
   then brought down to the exact size with high-quality smoothing: sharp edges, equal pixels.

   A canvas given to keepSharp() is watched: its size in screen pixels is kept from a ResizeObserver (no layout read on
   each frame of a GIF) and redrawn when it changes; an IntersectionObserver tells whether it is in view (a GIF scrolled
   out of view is not played). */
let step = null;   // the whole-number enlargement, made once (not at load: the tests run without a page)

const sizeOf = (source) => ({
  width: source.displayWidth ?? source.naturalWidth ?? source.width,
  height: source.displayHeight ?? source.naturalHeight ?? source.height,
});

const sizes = new WeakMap();   // canvas -> { width, height } in screen pixels, inside the border
const inView = new WeakMap();   // canvas -> true / false
const redraws = new WeakMap();   // canvas -> redraw()

/* Its size measured now (a canvas not watched, or before its first report): inside the border, in screen pixels. */
const measure = (canvas) => {
  const box = canvas.getBoundingClientRect();
  if (!box.width || !box.height) { return { width: 0, height: 0 }; }
  const ratio = window.devicePixelRatio || 1;
  return {
    width: Math.round((box.width - (canvas.offsetWidth - canvas.clientWidth)) * ratio),
    height: Math.round((box.height - (canvas.offsetHeight - canvas.clientHeight)) * ratio),
  };
};

/* Draws `source` (canvas, image, ImageBitmap, VideoFrame) into `canvas`, whole and centred. False when the canvas is not
   on screen (no size): nothing drawn. */
export const drawSharp = (canvas, source) => {
  const { width, height } = sizes.get(canvas) ?? measure(canvas);
  if (!width || !height) { return false; }
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

const resized = typeof ResizeObserver === "function" ? new ResizeObserver((entries) => {
  for (const { target, devicePixelContentBoxSize, contentRect } of entries) {
    const exact = devicePixelContentBoxSize?.[0];
    const ratio = window.devicePixelRatio || 1;
    sizes.set(target, exact
      ? { width: exact.inlineSize, height: exact.blockSize }
      : { width: Math.round(contentRect.width * ratio), height: Math.round(contentRect.height * ratio) });
    redraws.get(target)?.();
  }
}) : null;
const seen = typeof IntersectionObserver === "function" ? new IntersectionObserver((entries) => {
  for (const { target, isIntersecting } of entries) { inView.set(target, isIntersecting); }
}) : null;

/* Watches a canvas: redrawn when its size on screen changes (window resized, panel opened, zoom). */
export const keepSharp = (canvas, redraw) => {
  redraws.set(canvas, redraw);
  if (resized) {
    try { resized.observe(canvas, { box: "device-pixel-content-box" }); } catch (error) { resized.observe(canvas); }
  }
  seen?.observe(canvas);
};
export const stopSharp = (canvas) => {
  redraws.delete(canvas);
  sizes.delete(canvas);
  inView.delete(canvas);
  resized?.unobserve(canvas);
  seen?.unobserve(canvas);
};
/* Whether a watched canvas can be seen now: on screen, in view, browser tab in front. */
export const isShown = (canvas) => !document.hidden && inView.get(canvas) !== false && (sizes.get(canvas)?.width ?? measure(canvas).width) > 0;
