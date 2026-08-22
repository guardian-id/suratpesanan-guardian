import { getDocument } from "pdfjs-serverless";

const GITHUB_BASE =
  "https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main";

const TEMPLATE = {
  reguler:
    `${GITHUB_BASE}/Reguler.html`,

  prekursor:
    `${GITHUB_BASE}/Prekursor.html`
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

      const requestedTemplate =
        String(
          body.template || ""
        )
          .trim()
          .toLowerCase();


      let templateUrl;


      if (
        requestedTemplate ===
        "reguler"
      ) {

        templateUrl =
          TEMPLATE.reguler;

      } else if (
        requestedTemplate ===
        "prekursor"
      ) {

        templateUrl =
          TEMPLATE.prekursor;

      } else {

        throw new Error(
          `Template tidak valid: "${body.template}". Gunakan Reguler atau Prekursor.`
        );

      }


      // =====================================================
      // AMBIL TEMPLATE HTML
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
      // PDF SUMBER
      // =====================================================

      const sourcePdfBase64 =
        cleanBase64(
          body.pdfBase64
        );


      if (!sourcePdfBase64) {

        throw new Error(
          "pdfBase64 tidak ditemukan. Power Automate harus mengirim PDF sumber."
        );

      }


      // =====================================================
      // PDF BASE64 → BINARY
      // =====================================================

      const sourcePdfBytes =
        base64ToBytes(
          sourcePdfBase64
        );


      // =====================================================
      // BACA PDF DENGAN PDF.JS
      // =====================================================

      const pdfDocument =
        await getDocument({

          data:
            sourcePdfBytes,

          useSystemFonts:
            true

        }).promise;


      const totalSourcePages =
        pdfDocument.numPages;


      if (
        !totalSourcePages ||
        totalSourcePages < 1
      ) {

        throw new Error(
          "PDF sumber tidak mempunyai halaman."
        );

      }


      // =====================================================
      // EXTRACT TEXT PER HALAMAN
      // =====================================================

      const pages = [];


      for (
        let pageNumber = 1;
        pageNumber <= totalSourcePages;
        pageNumber++
      ) {

        const page =
          await pdfDocument.getPage(
            pageNumber
          );


        const textContent =
          await page.getTextContent();


        const items =
          textContent.items || [];


        const text =
          items
            .map(
              item =>
                String(
                  item.str || ""
                )
            )
            .join(" ");


        pages.push({

          pageNumber,

          text

        });

      }


      // =====================================================
      // PARSE DATA TABEL
      // =====================================================

      const tableRows =
        parseSourceTable(
          pages
        );


      // =====================================================
      // BUAT TABLE HTML
      // =====================================================

      const tableHtml =
        buildMedicineTable(
          tableRows
        );


      // =====================================================
      // TABLE
      // =====================================================

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
      // TAMBAHKAN CSS
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

            html,

            pdfOptions: {

              format:
                "a4",

              landscape:
                false,

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
          "PDF berhasil dibuat.",

        template:
          requestedTemplate === "reguler"
            ? "Reguler"
            : "Prekursor",

        sourcePages:
          totalSourcePages,

        tableRows:
          tableRows.length,

        spBase64

      });


    } catch (error) {

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
// PARSE TABLE DARI PDF SUMBER
// =========================================================

function parseSourceTable(
  pages
) {

  const rows = [];


  for (
    const page of pages
  ) {

    const text =
      page.text || "";


    /*
      Format sumber:

      No
      Product SKU
      Product Description
      Kemasan
      Case Pack
      Qty
      Shipping
      Batch Number
      Expired Date
      Invoice No

      Contoh:

      1 3102695
      ACETYLSISTEINE CAPSULE200MG 1S NOVELL
      BOX 20 2 EIK113 2027-11-01 58216245
    */


    const lines =
      normalizePdfText(
        text
      );


    let startIndex =
      findTableStart(
        lines
      );


    if (
      startIndex === -1
    ) {

      continue;

    }


    for (
      let i =
        startIndex;
      i <
        lines.length;
      i++
    ) {

      const line =
        lines[i];


      // -------------------------------------------------
      // STOP
      // -------------------------------------------------

      if (
        /^Total Qty Shipping/i.test(
          line
        )
      ) {

        break;

      }


      if (
        /^TTD APJ/i.test(
          line
        )
      ) {

        break;

      }


      // -------------------------------------------------
      // CARI AWAL BARIS PRODUK
      // -------------------------------------------------

      const match =
        line.match(
          /^(\d+)\s+(\d{6,8})\s+(.+)$/
        );


      if (!match) {

        continue;

      }


      const no =
        match[1];


      const sku =
        match[2];


      let product =
        match[3].trim();


      /*
        Data berikutnya sering berada
        pada baris yang sama atau
        pecah menjadi beberapa item.
      */

      let combined =
        product;


      let j =
        i + 1;


      while (
        j < lines.length
      ) {

        const next =
          lines[j];


        if (
          /^\d+\s+\d{6,8}\s+/.test(
            next
          )
        ) {

          break;

        }


        if (
          /^Total Qty Shipping/i.test(
            next
          )
        ) {

          break;

        }


        if (
          /^TTD APJ/i.test(
            next
          )
        ) {

          break;

        }


        combined +=
          " " +
          next;


        j++;

      }


      const parsed =
        parseProductData(
          combined
        );


      if (!parsed) {

        continue;

      }


      rows.push({

        no,

        sku,

        product:
          parsed.product,

        satuan:
          parsed.satuan,

        qty:
          parsed.qty,

        batch:
          parsed.batch,

        exp:
          parsed.exp,

        invoice:
          parsed.invoice

      });


      i =
        j - 1;

    }

  }


  return rows;

}


// =========================================================
// PARSE SATU PRODUK
// =========================================================

function parseProductData(
  text
) {

  const cleaned =
    text
      .replace(
        /\s+/g,
        " "
      )
      .trim();


  /*
    Bagian belakang PDF sumber:

    ... BOX 20 2 EIK113 2027-11-01 58216245

    atau:

    ... TUBE 8 8 VF1516 2027-06-01 58216245
  */


  const match =
    cleaned.match(
      /^(.*?)\s+([A-Za-z]+)\s+(\d+)\s+(\d+)\s+([A-Za-z0-9-]+)\s+(\d{4}-\d{2}-\d{2})\s+(\d+)\s*$/
    );


  if (!match) {

    return null;

  }


  return {

    product:
      match[1].trim(),

    satuan:
      match[2].trim(),

    casePack:
      match[3],

    qty:
      match[4],

    batch:
      match[5],

    exp:
      match[6],

    invoice:
      match[7]

  };

}


// =========================================================
// CARI AWAL TABLE
// =========================================================

function findTableStart(
  lines
) {

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {

    const line =
      lines[i].toLowerCase();


    if (
      line.includes("product sku") &&
      line.includes("product description")
    ) {

      return i + 1;

    }

  }


  return -1;

}


// =========================================================
// NORMALIZE PDF TEXT
// =========================================================

function normalizePdfText(
  text
) {

  return text

    .replace(
      /\u00a0/g,
      " "
    )

    .split(/\r?\n/)

    .map(
      x =>
        x
          .replace(
            /\s+/g,
            " "
          )
          .trim()
    )

    .filter(
      Boolean
    );

}


// =========================================================
// BUILD MEDICINE TABLE
// =========================================================

function buildMedicineTable(
  rows
) {

  if (
    !rows.length
  ) {

    return `

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

            <td
              colspan="7"
              style="text-align:center;"
            >
              Tidak ada data obat yang ditemukan dari PDF sumber.
            </td>

          </tr>

        </tbody>

      </table>

    `;

  }


  let html = `

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

  `;


  for (
    const row of rows
  ) {

    html += `

      <tr>

        <td>
          ${escapeHtml(row.no)}
        </td>

        <td>
          ${escapeHtml(row.product)}
        </td>

        <td>
          ${escapeHtml(row.satuan)}
        </td>

        <td>
          
        </td>

        <td>
          
        </td>

        <td>
          ${escapeHtml(row.qty)}
        </td>

        <td>
          Batch: ${escapeHtml(row.batch)}
          <br>
          Exp: ${escapeHtml(row.exp)}
          <br>
          Invoice: ${escapeHtml(row.invoice)}
        </td>

      </tr>

    `;

  }


  html += `

      </tbody>

    </table>

  `;


  return html;

}


// =========================================================
// CSS PDF
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


      body {

        box-sizing:
          border-box;

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


      tr {

        page-break-inside:
          avoid;

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


  if (
    image.startsWith(
      "data:image/"
    )
  ) {

    return image;

  }


  const match =
    image.match(
      /<img[^>]+src=["']([^"']+)["']/i
    );


  if (match) {

    return match[1];

  }


  image =
    image.replace(
      /\s/g,
      ""
    );


  return `
    data:image/png;base64,${image}
  `;

}


// =========================================================
// CLEAN BASE64
// =========================================================

function cleanBase64(
  value
) {

  if (!value) {

    return "";

  }


  let base64 =
    String(value).trim();


  const commaIndex =
    base64.indexOf(",");


  if (
    base64.startsWith(
      "data:"
    ) &&
    commaIndex !== -1
  ) {

    base64 =
      base64.substring(
        commaIndex + 1
      );

  }


  base64 =
    base64.replace(
     (/\s/g),
      ""
    );


  return base64;

}


// =========================================================
// BASE64 → BYTES
// =========================================================

function base64ToBytes(
  base64
) {

  const binary =
    atob(base64);


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
