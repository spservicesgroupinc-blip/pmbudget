/**
 * Server-side PDF text extraction for DeepSeek processing.
 *
 * The DeepSeek chat API is text-only (no PDF/file input), so uploaded
 * Xactimate PDFs are converted to plain text here before being sent to
 * the model.
 */
export async function extractPdfText(pdfBase64: string): Promise<string> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const cleanBase64 = pdfBase64.replace(/^data:[^;]+;base64,/, '');
  const bytes = Buffer.from(cleanBase64, 'base64');

  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;

  try {
    const pages: string[] = [];

    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      let pageText = '';

      for (const item of content.items) {
        if ('str' in item && typeof item.str === 'string') {
          pageText += item.hasEOL ? `${item.str}\n` : `${item.str} `;
        }
      }

      pages.push(pageText.trim());
      page.cleanup();
    }

    return pages.join('\n\n');
  } finally {
    await loadingTask.destroy();
  }
}
