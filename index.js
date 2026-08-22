import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getDocument } from "pdfjs-serverless";

const TEMPLATE_URL =
  "https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main/Reguler.pdf";

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
        return response(
          {
            success: false,
            message: "Gunakan method POST."
          },
          405
        );
      }

      const body = await request.json();

      /*
       * =====================================================
       * 1. VALIDASI TEMPLATE
       * =====================================================
       */

      const template =
        String(body.template || "")
          .trim()
          .toLowerCase();

      if (template !== "reguler") {
        return response(
          {
            success: false,
            message:
              "Versi ini khusus template Reguler."
          },
          400
        );
      }

      /*
       * =====================================================
       * 2. PDF UPLOAD
       *
       * HANYA digunakan untuk menentukan jumlah halaman.
       * PDF upload TIDAK menjadi output.
       * =====================================================
       */

      if (!body.pdfBase64) {
        throw new Error(
          "pdfBase64 wajib dikirim."
        );
      }

      const uploadBytes =
        base64ToBytes(
          body.pdfBase64
        );

      validatePdf(
        uploadBytes,
        "PDF upload"
      );

      const uploadPdf =
        await PDFDocument.load(
          uploadBytes
        );

      const uploadPages =
        uploadPdf.getPageCount();

      /*
       * =====================================================
       * 3. DOWNLOAD TEMPLATE REGULER
       * =====================================================
       */

      const templateBytes =
        await downloadBytes(
          TEMPLATE_URL
        );

      validatePdf(
        templateBytes,
        "Reguler.pdf"
      );

      /*
       * =====================================================
       * 4. LOAD TEMPLATE
       * =====================================================
       */

      const templatePdf =
        await PDFDocument.load(
          templateBytes
        );

      const templatePages =
        templatePdf.getPageCount();

      if (templatePages === 0) {
        throw new Error(
          "Reguler.pdf tidak mempunyai halaman."
        );
      }

      /*
       * =====================================================
       * 5. BUAT OUTPUT
       *
       * JUMLAH HALAMAN = PDF UPLOAD
       * =====================================================
       */

      const outputPdf =
        await PDFDocument.create();

      /*
       * =====================================================
       * 6. COPY TEMPLATE
       * =====================================================
       */

      for (
        let i = 0;
        i < uploadPages;
        i++
      ) {
        const sourceIndex =
          i % templatePages;

        const [page] =
          await outputPdf.copyPages(
            templatePdf,
            [sourceIndex]
          );

        outputPdf.addPage(page);
      }

      /*
       * =====================================================
       * 7. AMBIL POSISI PLACEHOLDER
       * DARI TEMPLATE REGULER
       *
       * Kita baca template ORIGINAL,
       * bukan PDF upload.
       * =====================================================
       */

      const positions =
        await findPlaceholderPositions(
          templateBytes
        );

      /*
       * =====================================================
       * 8. REPLACE Satu - Duabelas
       * =====================================================
       */

      const font =
        await outputPdf.embedFont(
          StandardFonts.Helvetica
        );

      replaceValues(
        outputPdf,
        positions,
        body,
        font
      );

      /*
       * =====================================================
       * 9. SAVE
       * =====================================================
       */

      const outputBytes =
        await outputPdf.save();

      const outputBase64 =
        bytesToBase64(
          outputBytes
        );

      /*
       * =====================================================
       * 10. RESPONSE
       * =====================================================
       */

      return response({
        success: true,

        message:
          "PDF Reguler berhasil diproses.",

        template:
          "Reguler",

        pages:
          outputPdf.getPageCount(),

        sourcePages:
          uploadPages,

        placeholdersFound:
          Object.keys(positions),

        spBase64:
          outputBase64
      });

    } catch (error) {
      return response(
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
 * =========================================================
 * CARI POSISI PLACEHOLDER
 * =========================================================
 */

async function findPlaceholderPositions(
  pdfBytes
) {
  const pdfjs =
    await getDocument({
      data:
        new Uint8Array(
          pdfBytes
        ),
      useSystemFonts: true
    }).promise;

  const result = {};

  for (
    let pageNumber = 1;
    pageNumber <= pdfjs.numPages;
    pageNumber++
  ) {
    const page =
      await pdfjs.getPage(
        pageNumber
      );

    const content =
      await page.getTextContent();

    const items =
      content.items || [];

    for (
      const placeholder of PLACEHOLDERS
    ) {
      /*
       * Jangan ambil posisi yang sama
       * berkali-kali pada halaman yang sama.
       */

      if (
        !result[placeholder]
      ) {
        result[placeholder] = [];
      }

      /*
       * CASE 1:
       * placeholder berada dalam satu text item
       */

      for (
        let i = 0;
        i < items.length;
        i++
      ) {
        const item =
          items[i];

        if (
          typeof item.str !== "string"
        ) {
          continue;
        }

        if (
          item.str.includes(
            placeholder
          )
        ) {
          result[placeholder].push({
            page:
              pageNumber - 1,

            x:
              item.transform[4],

            y:
              item.transform[5],

            width:
              item.width || 0,

            fontSize:
              Math.abs(
                item.transform[3] || 10
              ),

            text:
              item.str
          });

          break;
        }
      }

      /*
       * CASE 2:
       * placeholder terpecah menjadi beberapa
       * text item.
       *
       * Contoh:
       *
       * "Sa" + "tu"
       *
       * atau:
       *
       * "Dua" + "belas"
       */

      if (
        result[placeholder].length === 0
      ) {
        for (
          let start = 0;
          start < items.length;
          start++
        ) {
          let combined = "";

          let first = null;
          let last = null;

          for (
            let j = start;
            j < Math.min(
              start + 10,
              items.length
            );
            j++
          ) {
            const item =
              items[j];

            if (
              typeof item.str !==
              "string"
            ) {
              continue;
            }

            if (!first) {
              first = item;
            }

            combined +=
              item.str;

            last = item;

            if (
              combined.includes(
                placeholder
              )
            ) {
              result[
                placeholder
              ].push({
                page:
                  pageNumber - 1,

                x:
                  first.transform[4],

                y:
                  first.transform[5],

                width:
                  getCombinedWidth(
                    first,
                    last
                  ),

                fontSize:
                  Math.abs(
                    first.transform[3] ||
                    10
                  ),

                text:
                  combined
              });

              break;
            }
          }

          if (
            result[placeholder].length >
            0
          ) {
            break;
          }
        }
      }
    }
  }

  try {
    await pdfjs.destroy();
  } catch (_) {}

  return result;
}


/*
 * =========================================================
 * REPLACE VALUE
 * =========================================================
 */

function replaceValues(
  pdf,
  positions,
  body,
  font
) {
  const pages =
    pdf.getPages();

  for (
    const placeholder of PLACEHOLDERS
  ) {
    const locations =
      positions[placeholder] || [];

    let value =
      body[placeholder];

    if (
      value === undefined ||
      value === null
    ) {
      value = "";
    }

    value =
      String(value);

    /*
     * Kalau kosong, placeholder tetap
     * akan dihapus.
     */

    for (
      const location of locations
    ) {
      const page =
        pages[location.page];

      if (!page) {
        continue;
      }

      const x =
        location.x;

      const y =
        location.y;

      const fontSize =
        Math.max(
          6,
          location.fontSize
        );

      const oldWidth =
        Math.max(
          location.width,
          placeholder.length *
            fontSize *
            0.5
        );

      /*
       * HAPUS PLACEHOLDER
       */

      page.drawRectangle({
        x:
          x - 2,

        y:
          y - fontSize - 3,

        width:
          oldWidth + 6,

        height:
          fontSize + 7,

        color:
          rgb(
            1,
            1,
            1
          )
      });

      /*
       * JIKA VALUE KOSONG,
       * SELESAI.
       */

      if (
        value.trim() === ""
      ) {
        continue;
      }

      /*
       * TULIS VALUE
       *
       * Posisi awal mengikuti posisi
       * placeholder asli.
       */

      page.drawText(
        value,
        {
          x:
            x,

          y:
            y - 1,

          size:
            fontSize,

          font,

          color:
            rgb(
              0,
              0,
              0
            ),

          lineHeight:
            fontSize * 1.15
        }
      );
    }
  }
}


/*
 * =========================================================
 * COMBINED WIDTH
 * =========================================================
 */

function getCombinedWidth(
  first,
  last
) {
  if (
    !first ||
    !last
  ) {
    return 0;
  }

  const x1 =
    first.transform?.[4] || 0;

  const x2 =
    last.transform?.[4] || 0;

  return (
    Math.abs(
      x2 - x1
    ) +
    (last.width || 0)
  );
}


/*
 * =========================================================
 * DOWNLOAD
 * =========================================================
 */

async function downloadBytes(
  url
) {
  const response =
    await fetch(
      url,
      {
        headers: {
          "User-Agent":
            "Guardian-PDF-Worker"
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      `Gagal mengambil Reguler.pdf dari GitHub. HTTP ${response.status}`
    );
  }

  return new Uint8Array(
    await response.arrayBuffer()
  );
}


/*
 * =========================================================
 * BASE64 -> BYTES
 * =========================================================
 */

function base64ToBytes(
  input
) {
  let value =
    String(
      input || ""
    ).trim();

  /*
   * DATA URI
   */

  if (
    value.startsWith("data:")
  ) {
    const comma =
      value.indexOf(",");

    if (
      comma !== -1
    ) {
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
  } catch (_) {
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
 * =========================================================
 * BYTES -> BASE64
 * =========================================================
 */

function bytesToBase64(
  bytes
) {
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

  return btoa(
    binary
  );
}


/*
 * =========================================================
 * VALIDATE PDF
 * =========================================================
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


/*
 * =========================================================
 * RESPONSE
 * =========================================================
 */

function response(
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
