import { PDFDocument } from "pdf-lib";

export default {
  async fetch(request) {
    try {
      if (request.method !== "POST") {
        return json(
          {
            success: false,
            message: "Method harus POST."
          },
          405
        );
      }

      const body = await request.json();

      const pdfBase64 = body.pdfBase64 || "";

      if (!pdfBase64) {
        return json(
          {
            success: false,
            message: "pdfBase64 tidak dikirim."
          },
          400
        );
      }

      // =====================================================
      // BASE64 → BYTES
      // =====================================================

      const inputBytes = base64ToBytes(pdfBase64);

      validatePdf(
        inputBytes,
        "pdfBase64"
      );

      // =====================================================
      // LOAD PDF UPLOAD
      // =====================================================

      const sourcePdf =
        await PDFDocument.load(
          inputBytes
        );

      const pageCount =
        sourcePdf.getPageCount();

      if (pageCount === 0) {
        throw new Error(
          "PDF upload tidak memiliki halaman."
        );
      }

      // =====================================================
      // CREATE OUTPUT PDF
      // =====================================================

      const outputPdf =
        await PDFDocument.create();

      // =====================================================
      // COPY SEMUA HALAMAN
      //
      // Contoh:
      // Upload 6 halaman
      // → Output 6 halaman
      // =====================================================

      const pageIndexes =
        Array.from(
          {
            length: pageCount
          },
          (_, i) => i
        );

      const copiedPages =
        await outputPdf.copyPages(
          sourcePdf,
          pageIndexes
        );

      for (const page of copiedPages) {
        outputPdf.addPage(page);
      }

      // =====================================================
      // SAVE
      // =====================================================

      const outputBytes =
        await outputPdf.save();

      const outputBase64 =
        bytesToBase64(
          outputBytes
        );

      // =====================================================
      // RESPONSE
      // =====================================================

      return json({
        success: true,

        message:
          "TEST PDF berhasil.",

        inputPages:
          pageCount,

        outputPages:
          outputPdf.getPageCount(),

        spBase64:
          outputBase64
      });

    } catch (error) {

      return json(
        {
          success: false,

          message:
            error?.message ||
            "Terjadi error pada Worker."
        },
        500
      );

    }
  }
};


// =========================================================
// BASE64 → BYTES
// =========================================================

function base64ToBytes(input) {

  let value =
    String(
      input || ""
    ).trim();

  // Data URI
  if (
    value.startsWith("data:")
  ) {

    const comma =
      value.indexOf(",");

    if (comma !== -1) {
      value =
        value.substring(
          comma + 1
        );
    }
  }

  // HTML IMG bukan untuk PDF,
  // tapi kita bersihkan jika ada.
  const imgMatch =
    value.match(
      /<img[^>]+src=["']data:[^;]+;base64,([^"']+)["']/i
    );

  if (
    imgMatch &&
    imgMatch[1]
  ) {
    value =
      imgMatch[1];
  }

  value =
    value.replace(
      /\s/g,
      ""
    );

  if (!value) {
    throw new Error(
      "Base64 kosong."
    );
  }

  let binary;

  try {

    binary =
      atob(value);

  } catch (error) {

    throw new Error(
      "pdfBase64 bukan Base64 yang valid."
    );

  }

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

  return bytes;
}


// =========================================================
// BYTES → BASE64
// =========================================================

function bytesToBase64(bytes) {

  let binary = "";

  const chunkSize =
    0x8000;

  for (
    let i = 0;
    i < bytes.length;
    i += chunkSize
  ) {

    binary +=
      String.fromCharCode(
        ...bytes.subarray(
          i,
          Math.min(
            i + chunkSize,
            bytes.length
          )
        )
      );

  }

  return btoa(binary);
}


// =========================================================
// VALIDATE PDF
// =========================================================

function validatePdf(
  bytes,
  name
) {

  if (
    !bytes ||
    bytes.length < 5
  ) {

    throw new Error(
      `${name} kosong.`
    );

  }

  const header =
    new TextDecoder().decode(
      bytes.slice(
        0,
        5
      )
    );

  if (
    header !== "%PDF-"
  ) {

    throw new Error(
      `${name} bukan PDF valid.`
    );

  }
}


// =========================================================
// JSON
// =========================================================

function json(
  data,
  status = 200
) {

  return new Response(
    JSON.stringify(data),
    {
      status,

      headers: {
        "Content-Type":
          "application/json; charset=utf-8"
      }
    }
  );

}
