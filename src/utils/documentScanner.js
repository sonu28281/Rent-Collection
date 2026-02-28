/**
 * Document Scanner Utility
 * Enhances captured photos to look like clean scanned documents.
 * Applies: contrast boost, brightness adjustment, sharpening, and adaptive thresholding.
 */

/**
 * Process an image file/dataURL to produce a clean scanned-document look.
 * @param {string} dataUrl - Base64 data URL of the image
 * @param {object} options - Processing options
 * @param {boolean} options.isSelfie - If true, skip document processing (keep natural look)
 * @returns {Promise<string>} - Processed image as data URL
 */
export const scanDocument = (dataUrl, options = {}) => {
  const { isSelfie = false } = options;

  // Don't process selfies - keep them natural
  if (isSelfie) return Promise.resolve(dataUrl);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Limit max dimension for performance (keep aspect ratio)
        const MAX_DIM = 1600;
        let { width, height } = img;
        if (width > MAX_DIM || height > MAX_DIM) {
          const scale = MAX_DIM / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }

        canvas.width = width;
        canvas.height = height;

        // Draw original
        ctx.drawImage(img, 0, 0, width, height);

        // Get pixel data
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        // --- Step 1: Convert to grayscale and compute histogram ---
        const gray = new Uint8Array(width * height);
        const histogram = new Uint32Array(256);

        for (let i = 0; i < data.length; i += 4) {
          // Luminance formula
          const g = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
          gray[i / 4] = g;
          histogram[g]++;
        }

        // --- Step 2: Auto-levels (stretch contrast) ---
        const totalPixels = width * height;
        const clipPercent = 0.005; // clip 0.5% from each end
        const clipCount = Math.floor(totalPixels * clipPercent);

        let minLevel = 0;
        let maxLevel = 255;
        let cumulative = 0;

        for (let i = 0; i < 256; i++) {
          cumulative += histogram[i];
          if (cumulative > clipCount) {
            minLevel = i;
            break;
          }
        }

        cumulative = 0;
        for (let i = 255; i >= 0; i--) {
          cumulative += histogram[i];
          if (cumulative > clipCount) {
            maxLevel = i;
            break;
          }
        }

        const range = Math.max(maxLevel - minLevel, 1);

        // --- Step 3: Apply enhancement to each pixel ---
        for (let i = 0; i < data.length; i += 4) {
          // Stretch each channel
          let r = ((data[i] - minLevel) / range) * 255;
          let g = ((data[i + 1] - minLevel) / range) * 255;
          let b = ((data[i + 2] - minLevel) / range) * 255;

          // Boost contrast (S-curve)
          r = applySCurve(r);
          g = applySCurve(g);
          b = applySCurve(b);

          // Slight brightness boost for document whites
          r = Math.min(255, r * 1.05);
          g = Math.min(255, g * 1.05);
          b = Math.min(255, b * 1.05);

          // Increase saturation slightly for colored docs
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          const satBoost = 1.15;
          r = clamp(lum + (r - lum) * satBoost);
          g = clamp(lum + (g - lum) * satBoost);
          b = clamp(lum + (b - lum) * satBoost);

          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
        }

        // --- Step 4: Unsharp Mask (sharpen) ---
        ctx.putImageData(imageData, 0, 0);
        const sharpened = applySharpen(ctx, canvas, width, height);

        // Output as JPEG with good quality
        const result = sharpened.toDataURL('image/jpeg', 0.92);
        resolve(result);
      } catch (err) {
        console.error('Document scan processing failed, returning original:', err);
        resolve(dataUrl);
      }
    };
    img.onerror = () => {
      console.error('Failed to load image for scanning');
      resolve(dataUrl); // Return original on error
    };
    img.src = dataUrl;
  });
};

/** S-curve contrast enhancement */
function applySCurve(value) {
  const normalized = value / 255;
  // Sigmoid-like contrast curve
  const contrast = 1.4;
  const shifted = (normalized - 0.5) * contrast;
  const curved = 1 / (1 + Math.exp(-shifted * 5));
  return curved * 255;
}

/** Clamp value to 0-255 */
function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** Apply unsharp mask for sharpening */
function applySharpen(ctx, sourceCanvas, width, height) {
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = width;
  outputCanvas.height = height;
  const outCtx = outputCanvas.getContext('2d');

  // Draw enhanced image
  outCtx.drawImage(sourceCanvas, 0, 0);

  // Create blur for unsharp mask
  const blurCanvas = document.createElement('canvas');
  blurCanvas.width = width;
  blurCanvas.height = height;
  const blurCtx = blurCanvas.getContext('2d');
  blurCtx.filter = 'blur(1px)';
  blurCtx.drawImage(sourceCanvas, 0, 0);

  const originalData = outCtx.getImageData(0, 0, width, height);
  const blurredData = blurCtx.getImageData(0, 0, width, height);
  const od = originalData.data;
  const bd = blurredData.data;

  const amount = 0.5; // sharpening strength

  for (let i = 0; i < od.length; i += 4) {
    od[i] = clamp(od[i] + (od[i] - bd[i]) * amount);
    od[i + 1] = clamp(od[i + 1] + (od[i + 1] - bd[i + 1]) * amount);
    od[i + 2] = clamp(od[i + 2] + (od[i + 2] - bd[i + 2]) * amount);
  }

  outCtx.putImageData(originalData, 0, 0);
  return outputCanvas;
}

export default scanDocument;
