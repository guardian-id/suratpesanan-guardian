import { PDFDocument } from "pdf-lib";

export default {
  async fetch(request) {

    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Gunakan POST"
        }),
        {
          status: 405,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    try {

      const body = await request.json();

      console.log("STEP 1 - JSON diterima");

      if (!body.pdfBase64) {
        throw new Error("pdfBase64 kosong");
      }

      console.log("STEP 2 - pdfBase64 diterima");

      let base64 = String(body.pdfBase64);

      base64 = base64
        .replace(/^data:application\/pdf;base64,/i, "")
        .replace(/\s/g, "");

      console.log(
        "STEP 3 - base64 dibersihkan, length:",
        base64.length
      );

      const binary = atob(base64);

      console.log(
        "STEP 4 - base64 berhasil decode, length:",
        binary.length
      );

      const bytes = new Uint8Array(binary.length);

      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      console.log("STEP 5 - Uint8Array selesai");

      const pdfDoc = await PDFDocument.load(bytes);

      console.log("STEP 6 - PDFDocument.load selesai");

      const pages = pdfDoc.getPages();

      console.log(
        "STEP 7 - jumlah halaman:",
        pages.length
      );

      const output = await pdfDoc.save();

      console.log(
        "STEP 8 - PDF save selesai, bytes:",
        output.length
      );

      return new Response(
        JSON.stringify({
          success: true,
          message: "PDF berhasil diproses",
          pageCount: pages.length,
          outputSize: output.length
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );

    } catch (error) {

      console.error(
        "ERROR:",
        error
      );

      return new Response(
        JSON.stringify({
          success: false,
          message: error.message,
          error: String(error)
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }
  }
};
