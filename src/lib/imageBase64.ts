/** Read file as raw base64 + mime (no data: prefix) for API bodies. */
export function fileToBase64Parts(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
      if (m) {
        resolve({ mimeType: m[1], base64: m[2] });
      } else {
        reject(new Error('read failed'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
