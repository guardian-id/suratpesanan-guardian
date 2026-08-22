import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const GITHUB_BASE =
  "https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main";

const REGULER_URL =
  `${GITHUB_BASE}/Reguler.pdf`;

const PREKURSOR_URL =
  `${GITHUB_BASE}/Prekursor.pdf`;

const PLACEHOLDERS = [
  "Satu",
  "Dua",
  "Tiga",
  "Empat",
  "Lima",
  "Enam",
  "Tujuh",
  "Delapan",
  "Sembilan",
  "Sepuluh",
  "Sebelas",
  "Duabelas"
];

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

      const templateName =
        String(body.template || "Reguler")
          .trim()
          .toLowerCase();

      if (
        templateName !== "reguler" &&
        templateName !== "regular" &&
        templateName !== "prekursor"
      ) {
        throw new Error(
          `Template tidak dikenal: ${body.template}`
        );
      }

      /*
       * ==========================================
       * 1. AMBIL TEMPLATE DARI GITHUB
       * ==========================================
       */

      const templateUrl =
        templateName === "prekursor"
          ? PREKURSOR_URL
          : REGULER_URL;

      const templateBytes =
        await downloadBytes(templateUrl);

      validatePdf(
        templateBytes,
        "Template"
      );

      /*
       * ==========================================
       * 2. BACA PDF UPLOAD
       *
       * HANYA UNTUK JUMLAH HALAMAN
       * ==========================================
       */

      let uploadPageCount = 1;

      if (body.pdfBase64) {
        const uploadedBytes =
          base64ToBytes(body.pdfBase64);

        validatePdf(
          uploadedBytes,
          "pdfBase64"
        );

        uploadPageCount =
          await getPageCount(
            uploadedBytes
          );
      }

      /*
       * ==========================================
       * 3. LOAD TEMPLATE
       * ==========================================
       */

      const templatePdf =
        await PDFDocument.load(
          templateBytes
        );

      const templatePageCount =
        templatePdf.getPageCount();

      if (templatePageCount < 1) {
        throw new Error(
          "Template PDF tidak memiliki halaman."
        );
      }

      /*
       * ==========================================
       * 4. BUAT OUTPUT
       *
       * JUMLAH HALAMAN = PDF UPLOAD
       * ==========================================
       */

      const outputPdf =
        await PDFDocument.create();

      /*
       * ==========================================
       * 5. FONT
       * ==========================================
       */

      const font =
        await outputPdf.embedFont(
          StandardFonts.Helvetica
        );

      /*
       * ==========================================
       * 6. BUAT HALAMAN SESUAI PDF UPLOAD
       * ==========================================
       */

      for (
        let i = 0;
        i < uploadPageCount;
        i++
      ) {
        const sourceIndex =
          i % templatePageCount;

        const [copiedPage] =
          await outputPdf.copyPages(
            templatePdf,
            [sourceIndex]
          );

        outputPdf.addPage(
          copiedPage
        );
      }

      /*
       * ==========================================
       * 7. REPLACE Satu - Duabelas
       *
       * PENTING:
       * Kita gunakan text extraction sederhana
       * untuk mencari posisi.
       * ==========================================
       */

      await replaceTextInOutput(
        outputPdf,
        body,
        font
      );

      /*
       * ==========================================
       * 8. SAVE
       * ==========================================
       */

      const outputBytes =
        await outputPdf.save();

      const outputBase64 =
        bytesToBase64(
          outputBytes
        );

      /*
       * ==========================================
       * 9. RESPONSE
       * ==========================================
       */

      return json({
        success: true,

        message:
          "PDF berhasil diproses.",

        template:
          templateName === "prekursor"
            ? "Prekursor"
            : "Reguler",

        pages:
          outputPdf.getPageCount(),

        sourcePages:
          uploadPageCount,

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


/*
 * ==================================================
 * REPLACE TEXT
 * ==================================================
 *
 * CATATAN:
 * Untuk tahap pertama kita menggunakan
 * koordinat standar yang ditemukan dari
 * content stream PDF.
 *
 * Tahap ini sengaja sederhana supaya Worker
 * cepat dan stabil.
 */

async function replaceTextInOutput(
  pdf,
  body,
  font
) {
  const pages =
    pdf.getPages();

  /*
   * Karena pdf-lib tidak menyediakan text
   * extraction native, kita lakukan pendekatan
   * berdasarkan placeholder yang sudah diketahui.
   *
   * Untuk tahap pertama kita hanya melakukan
   * overlay jika koordinat sudah kita tentukan
   * dari template.
   *
   * Jangan menggambar TEST SATU di semua halaman.
   */

  const values = {};

  for (const key of PLACEHOLDERS) {
    values[key] =
      body[key] === undefined ||
      body[key] === null
        ? ""
        : String(body[key]);
  }

  /*
   * Untuk sementara jangan menggambar apa pun
   * secara acak.
   *
   * Ini sengaja dikosongkan sampai posisi
   * placeholder template kita pastikan.
   */

  /*
   * Fungsi ini dipertahankan sebagai tempat
   * untuk koordinat final template.
   */

  return;
}


/*
 * ==================================================
 * GET PAGE COUNT
 * ==================================================
 */

async function getPageCount(bytes) {
  const pdf =
    await PDFDocument.load(
      bytes
    );

  return pdf.getPageCount();
}


/*
 * ==================================================
 * DOWNLOAD
 * ==================================================
 */

async function downloadBytes(url) {
  const response =
    await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Gagal mengambil template GitHub. HTTP ${response.status}`
    );
  }

  return new Uint8Array(
    await response.arrayBuffer()
  );
}


/*
 * ==================================================
 * BASE64 -> BYTES
 * ==================================================
 */

function base64ToBytes(input) {
  let value =
    String(input || "").trim();

  /*
   * Data URI
   */
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

  /*
   * HTML IMG
   */
  const imgMatch =
    value.match(
      /<img[^>]+src=["']data:image\/[^;]+;base64,([^"']+)["']/i
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
      "Base64 tidak valid."
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


/*
 * ==================================================
 * BYTES -> BASE64
 * ==================================================
 */

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


/*
 * ==================================================
 * VALIDATE PDF
 * ==================================================
 */

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
      bytes.slice(0, 5)
    );

  if (
    header !== "%PDF-"
  ) {
    throw new Error(
      `${name} bukan PDF valid.`
    );
  }
}


/*
 * ==================================================
 * JSON RESPONSE
 * ==================================================
 */

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
