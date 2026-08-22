import { PDFDocument } from "pdf-lib";

export default {
  async fetch(request) {

    try {

      if (request.method !== "POST") {
        return json({
          success: false,
          message: "POST only"
        }, 405);
      }

      const body = await request.json();

      /*
       * Ambil PDF dari Power Automate
       */
      let pdfBase64 = body.pdfBase64 || "";

      if (!pdfBase64) {
        throw new Error("pdfBase64 kosong.");
      }

      /*
       * Bersihkan jika ternyata dikirim
       * sebagai data URI.
       */
      if (pdfBase64.startsWith("data:")) {
        const comma = pdfBase64.indexOf(",");

        if (comma !== -1) {
          pdfBase64 =
            pdfBase64.substring(comma + 1);
        }
      }

      pdfBase64 =
        pdfBase64
          .replace(/\s/g, "");

      /*
       * Base64 -> binary
       */
      const binary =
        atob(pdfBase64);

      const bytes =
        new Uint8Array(
          binary.length
        );

      for (
        let i = 0;
        i < binary.length;
        i++
      ) {
        bytes[i] =
          binary.charCodeAt(i);
      }

      /*
       * Pastikan benar-benar PDF
       */
      const header =
        new TextDecoder()
          .decode(
            bytes.slice(0, 8)
          );

      if (!header.startsWith("%PDF")) {
        throw new Error(
          `File bukan PDF. Header: ${header}`
        );
      }

      /*
       * LOAD PDF
       */
      const pdf =
        await PDFDocument.load(
          bytes
        );

      const pages =
        pdf.getPageCount();

      /*
       * Simpan kembali PDF
       */
      const output =
        await pdf.save();

      /*
       * Binary -> Base64
       */
      let outputBinary = "";

      const chunk =
        0x8000;

      for (
        let i = 0;
        i < output.length;
        i += chunk
      ) {

        outputBinary +=
          String.fromCharCode(
            ...output.subarray(
              i,
              Math.min(
                i + chunk,
                output.length
              )
            )
          );
      }

      const outputBase64 =
        btoa(outputBinary);

      return json({

        success: true,

        message:
          "PDF berhasil diterima dan diproses.",

        template:
          body.template || "",

        pages,

        inputBase64Length:
          pdfBase64.length,

        outputBase64Length:
          outputBase64.length,

        spBase64:
          outputBase64

      });

    } catch (error) {

      return json({

        success: false,

        message:
          error?.message ||
          "Unknown error"

      }, 500);
    }
  }
};


/* =========================================================
   JSON RESPONSE
   ========================================================= */

function json(data, status = 200) {

  return new Response(
    JSON.stringify(
      data,
      null,
      2
    ),
    {
      status,

      headers: {
        "Content-Type":
          "application/json"
      }
    }
  );
}
