export async function imageData(bytes: Uint8Array, mime: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: mime }));
  try {
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d'); if (!context) throw new Error('图片画布不可用。');
    context.fillStyle = '#fff'; context.fillRect(0,0,canvas.width,canvas.height); context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    signal?.throwIfAborted();
    return { image: canvas.toDataURL('image/jpeg',0.88), width: bitmap.width, height: bitmap.height };
  } finally { bitmap.close(); }
}
