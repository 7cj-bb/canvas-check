export function detectFormat(name: string, bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-') return 'pdf';
  if (new TextDecoder().decode(bytes.subarray(0,6)).startsWith('GIF8')) return 'gif';
  if (new TextDecoder().decode(bytes.subarray(0,4)) === 'RIFF' && new TextDecoder().decode(bytes.subarray(8,12)) === 'WEBP') return 'webp';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp';
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return extension === 'jpeg' ? 'jpg' : extension;
}
