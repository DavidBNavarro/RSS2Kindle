class ImageFetchError extends Error {
  constructor(msg, { url, status } = {}) {
    super(msg);
    this.name = "ImageFetchError";
    this.url = url;
    this.status = status;
  }
}

class ImageProcessError extends Error {
  constructor(msg, { blobType, width, height } = {}) {
    super(msg);
    this.name = "ImageProcessError";
    this.blobType = blobType;
    this.width = width;
    this.height = height;
  }
}

async function fetchImageAsBlob(url, opts = {}) {
  const { referer, signal } = opts;
  const headers = { Accept: "image/avif,image/webp,image/apng,image/*,*/*" };
  if (referer) headers.Referer = referer;
  try {
    const resp = await fetch(url, { headers, signal, credentials: "omit" });
    if (!resp.ok)
      throw new ImageFetchError(`HTTP ${resp.status} fetching ${url}`, {
        url,
        status: resp.status,
      });
    const ct = (resp.headers.get("content-type") || "image/jpeg")
      .split(";")[0]
      .trim();
    if (ct === "image/svg+xml")
      throw new ImageProcessError("SVG not supported", { blobType: ct });
    return resp.blob();
  } catch (err) {
    if (err instanceof ImageFetchError || err instanceof ImageProcessError)
      throw err;
    throw new ImageFetchError(err.message, { url });
  }
}

async function getImageInfo(blob) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
    const info = {
      width: bitmap.width,
      height: bitmap.height,
      type: blob.type,
    };
    bitmap.close();
    return info;
  } catch (err) {
    if (bitmap) bitmap.close();
    throw new ImageProcessError("Failed to decode image: " + err.message, {
      blobType: blob.type,
    });
  }
}

function shouldSkipImage(width, height, opts = {}) {
  const minDim = opts.minDim || 50;
  if (width < minDim || height < minDim) return true;
  const maxRatio = opts.maxRatio || 4;
  if (width > height * maxRatio || height > width * maxRatio) return true;
  return false;
}

function shouldRotateImage(width, height, opts = {}) {
  const minWidth = opts.minWidth || 500;
  const minDim = opts.minDim || 120;
  const ratio = opts.ratio || 1.2;
  if (width <= minWidth || height <= 0) return false;
  if (Math.min(width, height) < minDim) return false;
  if (width / height > ratio) return true;
  return false;
}

async function processImage(blob, opts = {}) {
  const { maxDimension = 1600, format = "image/jpeg", quality = 0.85 } = opts;
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch (err) {
    throw new ImageProcessError("Failed to decode: " + err.message, {
      blobType: blob.type,
    });
  }
  try {
    let { width, height } = bitmap;
    if (maxDimension > 0 && (width > maxDimension || height > maxDimension)) {
      const scale = Math.min(maxDimension / width, maxDimension / height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return canvas.convertToBlob({ type: format, quality });
  } catch (err) {
    if (bitmap) bitmap.close();
    throw new ImageProcessError("Failed to process image: " + err.message, {
      blobType: blob.type,
    });
  }
}

async function rotateImage(blob, degrees = 90) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch (err) {
    throw new ImageProcessError(
      "Failed to decode for rotation: " + err.message,
      { blobType: blob.type }
    );
  }
  try {
    const rad = (degrees * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const nw = Math.round(bitmap.width * cos + bitmap.height * sin);
    const nh = Math.round(bitmap.width * sin + bitmap.height * cos);
    const canvas = new OffscreenCanvas(nw, nh);
    const ctx = canvas.getContext("2d");
    ctx.translate(nw / 2, nh / 2);
    ctx.rotate(rad);
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    bitmap.close();
    return canvas.convertToBlob({ type: "image/png" });
  } catch (err) {
    if (bitmap) bitmap.close();
    throw new ImageProcessError(
      "Failed to rotate image: " + err.message,
      { blobType: blob.type }
    );
  }
}

async function convertFormat(blob, format, opts = {}) {
  const quality = opts.quality;
  return processImage(blob, {
    maxDimension: 0,
    format,
    ...(quality ? { quality } : {}),
  });
}

async function deliveryOptimize(blob) {
  return processImage(blob, {
    maxDimension: 1600,
    format: "image/jpeg",
    quality: 0.75,
  });
}

function estimateEpubSize(imageCount, avgImageBytes = 0, textBytes = 0) {
  const overheadPerImage = 512;
  const coverBytes = 4096;
  const metadataBytes = 2048;
  const zipOverhead = 1.1;
  const estimatedBytes =
    (textBytes + metadataBytes + coverBytes + imageCount * (avgImageBytes + overheadPerImage)) *
    zipOverhead;
  return Math.round(estimatedBytes);
}

const GMAIL_EPUB_LIMIT = 20 * 1024 * 1024;
const GMAIL_EPUB_WARN = 100 * 1024;

function warnEpubSize(blob) {
  const size = blob.size;
  if (size > GMAIL_EPUB_LIMIT) {
    return {
      oversize: true,
      size,
      message:
        "EPUB is " +
        _formatSize(size) +
        " — exceeds Gmail's ~25 MB send limit (base64 overhead). Try disabling images.",
    };
  }
  if (size > GMAIL_EPUB_WARN) {
    return {
      oversize: false,
      size,
      message: "EPUB is " + _formatSize(size) + " — large files may fail if many images.",
    };
  }
  return { oversize: false, size, message: "" };
}

function _formatSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + " KB";
  return bytes + " B";
}
