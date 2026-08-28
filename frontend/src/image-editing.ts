function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The image could not be opened in the browser editor.'));
    image.src = source;
  });
}

function canvasUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png', 0.96);
}

export async function rotateCatalogImage(source: string, degrees: -90 | 90): Promise<string> {
  const image = await loadImage(source);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalHeight;
  canvas.height = image.naturalWidth;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The browser image editor is unavailable.');
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((degrees * Math.PI) / 180);
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  return canvasUrl(canvas);
}

function colorDistance(data: Uint8ClampedArray, offset: number, reference: [number, number, number]): number {
  const red = data[offset] - reference[0];
  const green = data[offset + 1] - reference[1];
  const blue = data[offset + 2] - reference[2];
  return Math.sqrt(red * red + green * green + blue * blue);
}

export async function cleanCatalogBackground(source: string): Promise<string> {
  const image = await loadImage(source);
  const scale = Math.min(1, 1_600 / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  const context = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('The browser image editor is unavailable.');
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);

  const corners = [
    0,
    (width - 1) * 4,
    (height - 1) * width * 4,
    ((height - 1) * width + width - 1) * 4
  ];
  const background: [number, number, number] = [0, 1, 2].map((channel) =>
    Math.round(corners.reduce((sum, offset) => sum + pixels.data[offset + channel], 0) / corners.length)
  ) as [number, number, number];

  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let start = 0;
  let end = 0;
  const enqueue = (index: number) => {
    if (visited[index]) return;
    visited[index] = 1;
    queue[end++] = index;
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  const threshold = 62;
  while (start < end) {
    const index = queue[start++];
    const offset = index * 4;
    if (colorDistance(pixels.data, offset, background) > threshold) continue;
    pixels.data[offset + 3] = 0;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }
  context.putImageData(pixels, 0, 0);

  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels.data[(y * width + x) * 4 + 3] > 20) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }
  if (right < left || bottom < top) throw new Error('No foreground item remained after background detection. Restore the original and use rotate only.');

  const output = document.createElement('canvas');
  output.width = 1_600;
  output.height = 1_600;
  const outputContext = output.getContext('2d');
  if (!outputContext) throw new Error('The browser image editor is unavailable.');
  outputContext.fillStyle = '#ffffff';
  outputContext.fillRect(0, 0, output.width, output.height);
  const foregroundWidth = right - left + 1;
  const foregroundHeight = bottom - top + 1;
  const fit = Math.min(1_400 / foregroundWidth, 1_400 / foregroundHeight);
  const drawWidth = Math.round(foregroundWidth * fit);
  const drawHeight = Math.round(foregroundHeight * fit);
  outputContext.drawImage(
    sourceCanvas,
    left,
    top,
    foregroundWidth,
    foregroundHeight,
    Math.round((1_600 - drawWidth) / 2),
    Math.round((1_600 - drawHeight) / 2),
    drawWidth,
    drawHeight
  );
  return canvasUrl(output);
}
