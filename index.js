const GITHUB_BASE =
  "https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main";

const TEMPLATE = {
  reguler:
    "https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main/Reguler.html",

  prekursor:
    "https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main/Prekursor.html"
};


export default {

  async fetch(request, env) {

    try {

      // =====================================================
      // METHOD
      // =====================================================

      if (request.method !== "POST") {

        return response({
          success: false,
          message: "Gunakan method POST."
        }, 405);

      }


      // =====================================================
      // JSON BODY
      // =====================================================

      const body =
        await request.json();


      // =====================================================
      // TEMPLATE
      // =====================================================

      const templateInput =
        String(body.template || "Reguler")
          .trim()
          .toLowerCase();


      let templateName;
      let templateUrl;


      if (templateInput === "reguler") {

        templateName = "Reguler";

        templateUrl = TEMPLATE.reguler;

      }

      else if (templateInput === "prekursor") {

        templateName = "Prekursor";

        templateUrl = TEMPLATE.prekursor;

      }

      else {

        throw new Error(
          `Template tidak valid: ${body.template}`
        );

      }


      // =====================================================
      // AMBIL TEMPLATE HTML DARI GITHUB
      // =====================================================

      const templateResponse =
        await fetch(
          templateUrl
        );


      if (!templateResponse.ok) {

        throw new Error(
          `Template GitHub gagal diambil. HTTP ${templateResponse.status}`
        );

      }


      let html =
        await templateResponse.text();


      // =====================================================
      // REPLACE SATU - DUABELAS
      // =====================================================

      const fields = [

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


      for (
        const field of fields
      ) {

        const value =
          body[field] ?? "";


        html =
          html
            .split(
              `{{${field}}}`
            )
            .join(
              escapeHtml(
                String(value)
              )
            );

      }


      // =====================================================
      // TABLE PDF
      //
      // SEMENTARA DIABAIKAN
      // =====================================================

      let tableHtml =
        body.TablePDF || "";


      if (!tableHtml) {

        tableHtml = `

          <table class="medicine-table">

            <thead>

              <tr>

                <th>No</th>
                <th>Nama Obat</th>
                <th>Satuan</th>
                <th>Zat Aktif</th>
                <th>Bentuk</th>
                <th>Jumlah</th>
                <th>Keterangan</th>

              </tr>

            </thead>

            <tbody>

              <tr>

                <td colspan="7">
                  Tidak ada data tabel.
                </td>

              </tr>

            </tbody>

          </table>

        `;

      }


      html =
        html
          .split(
            "{{TablePDF}}"
          )
          .join(
            tableHtml
          );


      // =====================================================
      // TTD + STEMPEL
      // =====================================================

      const ttd =
        normalizeImage(
          body.ttdBase64
        );


      const stamp =
        normalizeImage(
          body.stempelBase64
        );


      let signatureHtml =
        "";


      if (
        ttd ||
        stamp
      ) {

        signatureHtml = `

          <div class="signature-container">

            ${
              stamp
                ? `

                  <img
                    src="${stamp}"
                    class="stamp"
                  >

                `
                : ""
            }

            ${
              ttd
                ? `

                  <img
                    src="${ttd}"
                    class="signature"
                  >

                `
                : ""
            }

          </div>

        `;

      }


      html =
        html
          .split(
            "{{TTD&Stemp}}"
          )
          .join(
            signatureHtml
          );


      // =====================================================
      // HAPUS PLACEHOLDER YANG TERSISA
      // =====================================================

      html =
        html.replace(
          /\{\{[^{}]+\}\}/g,
          ""
        );


      // =====================================================
      // TAMBAHKAN CSS PDF
      // =====================================================

      html =
        addPdfCss(
          html
        );


      // =====================================================
      // BROWSER CHECK
      // =====================================================

      if (!env.BROWSER) {

        throw new Error(
          "Binding BROWSER belum tersedia di Cloudflare Worker."
        );

      }


      // =====================================================
      // HTML → PDF
      // =====================================================

      const pdf =
        await env.BROWSER.quickAction(
          "pdf",
          {

            html: html,

            pdfOptions: {

              format:
                "a4",

              printBackground:
                true,

              preferCSSPageSize:
                true,

              margin: {

                top:
                  "0",

                right:
                  "0",

                bottom:
                  "0",

                left:
                  "0"

              }

            }

          }
        );


      if (!pdf.ok) {

        const error =
          await pdf.text();


        throw new Error(
          `HTML → PDF gagal: ${error}`
        );

      }


      // =====================================================
      // PDF BINARY → BASE64
      // =====================================================

      const pdfBytes =
        new Uint8Array(
          await pdf.arrayBuffer()
        );


      const spBase64 =
        bytesToBase64(
          pdfBytes
        );


      // =====================================================
      // RESPONSE
      // =====================================================

      return response({

        success:
          true,

        message:
          "HTML berhasil dikonversi menjadi PDF.",

        template:
          templateName,

        spBase64:
          spBase64

      });


    }

    catch (error) {

      return response({

        success:
          false,

        message:
          error?.message ||
          "Terjadi error."

      }, 500);

    }

  }

};


// =========================================================
// TAMBAHKAN CSS PDF
// =========================================================

function addPdfCss(
  html
) {

  const css = `

    <style>

      @page {

        size:
          A4 portrait;

        margin:
          0;

      }


      html,
      body {

        width:
          210mm;

        min-height:
          297mm;

        margin:
          0;

        padding:
          0;

      }


      .a4-container {

        width:
          210mm;

        min-height:
          297mm;

        box-sizing:
          border-box;

        page-break-after:
          always;

      }


      table {

        width:
          100%;

        border-collapse:
          collapse;

      }


      table th,
      table td {

        border:
          1px solid #000;

        padding:
          4px;

        vertical-align:
          top;

      }


      .medicine-table {

        width:
          100%;

        table-layout:
          fixed;

        font-size:
          9px;

      }


      .medicine-table th:nth-child(1) {

        width:
          6%;

      }


      .medicine-table th:nth-child(2) {

        width:
          25%;

      }


      .medicine-table th:nth-child(3) {

        width:
          10%;

      }


      .medicine-table th:nth-child(4) {

        width:
          19%;

      }


      .medicine-table th:nth-child(5) {

        width:
          12%;

      }


      .medicine-table th:nth-child(6) {

        width:
          8%;

      }


      .medicine-table th:nth-child(7) {

        width:
          20%;

      }


      .signature-container {

        position:
          relative;

        width:
          150px;

        height:
          100px;

      }


      .signature-container .stamp {

        position:
          absolute;

        left:
          40px;

        top:
          15px;

        width:
          85px;

        height:
          85px;

        object-fit:
          contain;

        z-index:
          1;

      }


      .signature-container .signature {

        position:
          absolute;

        left:
          0;

        top:
          0;

        width:
          105px;

        height:
          60px;

        object-fit:
          contain;

        z-index:
          2;

      }

    </style>

  `;


  return html.replace(
    "</head>",
    `${css}</head>`
  );

}


// =========================================================
// IMAGE NORMALIZER
// =========================================================

function normalizeImage(
  value
) {

  if (!value) {

    return "";

  }


  let image =
    String(value).trim();


  // Sudah data:image
  if (
    image.startsWith(
      "data:image/"
    )
  ) {

    return image;

  }


  // Format <img src="...">
  const match =
    image.match(
      /<img[^>]+src=["']([^"']+)["']/i
    );


  if (match) {

    return match[1];

  }


  // Base64 mentah
  image =
    image.replace(
      /\s/g,
      ""
    );


  return `data:image/png;base64,${image}`;

}


// =========================================================
// HTML ESCAPE
// =========================================================

function escapeHtml(
  value
) {

  return String(
    value ?? ""
  )

    .replace(
      /&/g,
      "&amp;"
    )

    .replace(
      /</g,
      "&lt;"
    )

    .replace(
      />/g,
      "&gt;"
    )

    .replace(
      /"/g,
      "&quot;"
    )

    .replace(
      /'/g,
      "&#039;"
    );

}


// =========================================================
// BYTES → BASE64
// =========================================================

function bytesToBase64(
  bytes
) {

  let binary =
    "";


  const chunk =
    0x8000;


  for (
    let i = 0;
    i < bytes.length;
    i += chunk
  ) {

    binary +=
      String.fromCharCode(
        ...bytes.subarray(
          i,
          Math.min(
            i + chunk,
            bytes.length
          )
        )
      );

  }


  return btoa(
    binary
  );

}


// =========================================================
// JSON RESPONSE
// =========================================================

function response(
  data,
  status = 200
) {

  return new Response(

    JSON.stringify(
      data
    ),

    {

      status,

      headers: {

        "Content-Type":
          "application/json; charset=utf-8"

      }

    }

  );

}
