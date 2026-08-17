declare module 'pdf-parse' {
  interface PdfParseResult {
    text: string
    numpages: number
    info: Record<string, unknown>
  }
  function pdfParse(buffer: Buffer): Promise<PdfParseResult>
  export default pdfParse
}
