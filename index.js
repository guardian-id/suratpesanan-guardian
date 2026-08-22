import { getDocument } from "pdfjs-serverless";

const GITHUB_BASE =
  "https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main";

const TEMPLATE = {
  reguler: GITHUB_BASE + "/Reguler.html",
  prekursor: GITHUB_BASE + "/Prekursor.html"
};

const MASTER_PREKURSOR_URL =
  GITHUB_BASE + "/master_prekursor.csv";

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
      // JSON
      // =====================================================

      const body =
        await request.json();


      // =====================================================
      // TEMPLATE
      // =====================================================

      const templateName =
        String(
          body.template || "Reguler"
        )
          .trim()
          .toLowerCase();


      if (!TEMPLATE[templateName]) {

        throw new Error(
          "Template harus Reguler atau Prekursor."
        );
      }


      // =====================================================
      // PDF SOURCE
      // =====================================================

      const pdfBase64 =
        String(
          body.pdfBase64 || ""
        ).trim();


      if (!pdfBase64) {

        throw new Error(
          "pdfBase64 tidak ditemukan."
        );
      }


      // =====================================================
      // AMBIL TEMPLATE HTML
      // =====================================================

      const templateResponse =
        await fetch(
          TEMPLATE[templateName]
        );


      if (!templateResponse.ok) {

        throw new Error(
          "Template GitHub gagal diambil. HTTP " +
          templateResponse.status
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


      for (const field of fields) {

        const value =
          body[field] ?? "";


        html =
          html
            .split(`{{${field}}}`)
            .join(
              escapeHtml(
                String(value)
              )
            );
      }


      // =====================================================
      // BACA PDF SUMBER
      // =====================================================

      const pdfBytes =
        base64ToUint8Array(
          pdfBase64
        );


      const pdfData =
        await extractPdfText(
          pdfBytes
        );


      // =====================================================
      // MASTER PREKURSOR
      // =====================================================

      let masterPrekursor = [];


      if (
        templateName === "prekursor"
      ) {

        masterPrekursor =
          await loadPrekursorMaster();
      }


      // =====================================================
      // PARSE TABEL PDF
      // =====================================================

      const products =
        parseProductRows(
          pdfData
        );


      if (!products.length) {

        throw new Error(
          "Tidak ditemukan baris produk pada PDF sumber."
        );
      }


      // =====================================================
      // BUAT TABLE HTML
      // =====================================================

      const tableHtml =
        buildMedicineTable(
          products,
          templateName,
          masterPrekursor
        );


      // =====================================================
      // INSERT TABLE
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


      let signatureHtml = "";


      if (ttd || stamp) {

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
      // HAPUS PLACEHOLDER TERSISA
      // =====================================================

      html =
        html.replace(
          /\{\{[^{}]+\}\}/g,
          ""
        );


      // =====================================================
      // CSS PDF
      // =====================================================

      html =
        addPdfCss(
          html
        );


      // =====================================================
      // BROWSER
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

              format: "a4",

              printBackground: true,

              preferCSSPageSize: true,

              margin: {
                top: "0",
                right: "0",
                bottom: "0",
                left: "0"
              }
            }
          }
        );


      if (!pdf.ok) {

        const error =
          await pdf.text();

        throw new Error(
          "HTML → PDF gagal: " +
          error
        );
      }


      // =====================================================
      // PDF → BASE64
      // =====================================================

      const finalPdfBytes =
        new Uint8Array(
          await pdf.arrayBuffer()
        );


      const spBase64 =
        bytesToBase64(
          finalPdfBytes
        );


      // =====================================================
      // RESPONSE
      // =====================================================

      return response({

        success: true,

        message:
          "PDF berhasil dibuat dari template HTML.",

        template:
          templateName === "prekursor"
            ? "Prekursor"
            : "Reguler",

        productCount:
          products.length,

        pdfPageCount:
          pdfData.pageCount,

        spBase64:
          spBase64

      });


    } catch (error) {

      return response({

        success: false,

        message:
          error?.message ||
          "Terjadi error."

      }, 500);
    }
  }
};


// =========================================================
// PDF TEXT EXTRACTION
// =========================================================

async function extractPdfText(
  pdfBytes
) {

  const loadingTask =
    getDocument({
      data: pdfBytes,
      useSystemFonts: true
    });


  const document =
    await loadingTask.promise;


  const pages = [];


  for (
    let pageNumber = 1;
    pageNumber <= document.numPages;
    pageNumber++
  ) {

    const page =
      await document.getPage(
        pageNumber
      );


    const textContent =
      await page.getTextContent();


    const items =
      textContent.items
        .filter(
          item =>
            typeof item.str === "string" &&
            item.str.trim() !== ""
        )
        .map(
          item => ({
            text:
              item.str.trim(),

            x:
              item.transform
                ? item.transform[4]
                : 0,

            y:
              item.transform
                ? item.transform[5]
                : 0
          })
        );


    const lines =
      groupTextItemsIntoLines(
        items
      );


    pages.push({
      pageNumber,
      lines
    });
  }


  return {
    pageCount:
      document.numPages,

    pages
  };
}


// =========================================================
// GROUP PDF TEXT BY VISUAL LINE
// =========================================================

function groupTextItemsIntoLines(
  items
) {

  const groups = [];

  const tolerance = 3;


  for (const item of items) {

    let group =
      groups.find(
        g =>
          Math.abs(
            g.y - item.y
          ) <= tolerance
      );


    if (!group) {

      group = {
        y: item.y,
        items: []
      };

      groups.push(
        group
      );
    }


    group.items.push(
      item
    );
  }


  groups.sort(
    (a, b) =>
      b.y - a.y
  );


  return groups.map(
    group => {

      group.items.sort(
        (a, b) =>
          a.x - b.x
      );


      return group.items
        .map(
          item => item.text
        )
        .join(" ")
        .replace(
          /\s+/g,
          " "
        )
        .trim();
    }
  );
}


// =========================================================
// PARSE PRODUCT ROWS
// =========================================================

function parseProductRows(
  pdfData
) {

  const products = [];


  for (
    const page of pdfData.pages
  ) {

    for (
      const line of page.lines
    ) {

      const product =
        parseProductLine(
          line
        );


      if (product) {

        products.push(
          product
        );
      }
    }
  }


  return products;
}


// =========================================================
// PARSE ONE PRODUCT LINE
// =========================================================

function parseProductLine(
  line
) {

  /*
    Bentuk sumber:

    1
    3102695
    ACETYLSISTEINE CAPSULE200MG
    1S NOVELL
    BOX
    20
    2
    EIK113
    2027-11-01
    58216245

    Setelah PDF.js menggabungkan posisi text,
    kita normalisasi menjadi satu string.
  */


  const text =
    String(line)
      .replace(
        /\s+/g,
        " "
      )
      .trim();


  /*
    Kita hanya mencari baris yang dimulai:

    NOMOR + SKU

    Contoh:

    1 3102695 ...
  */

  const startMatch =
    text.match(
      /^(\d+)\s+(\d{5,})\s+(.+)$/
    );


  if (!startMatch) {

    return null;
  }


  const no =
    startMatch[1];

  const sku =
    startMatch[2];

  let rest =
    startMatch[3].trim();


  /*
    Ambil dari belakang:

    Invoice
    Expired Date
    Batch Number
    Qty
    Case Pack
    Kemasan
  */


  const endMatch =
    rest.match(
      /^(.+?)\s+(\S+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\d{4}-\d{2}-\d{2})\s+(\d+)$/
    );


  if (!endMatch) {

    return null;
  }


  const description =
    endMatch[1].trim();

  const kemasan =
    endMatch[2].trim();

  const casePack =
    endMatch[3].trim();

  const qty =
    endMatch[4].trim();

  const batch =
    endMatch[5].trim();

  const expiredDate =
    endMatch[6].trim();

  const invoice =
    endMatch[7].trim();


  return {

    no,

    sku,

    description,

    kemasan,

    casePack,

    qty,

    batch,

    expiredDate,

    invoice
  };
}


// =========================================================
// BUILD MEDICINE TABLE
// =========================================================

function buildMedicineTable(
  products,
  templateName,
  masterPrekursor
) {

  let rows = "";


  for (
    const product of products
  ) {

    let zatAktif = "";

    let bentuk = "";


    /*
      HANYA PREKURSOR yang lookup
      ke master_prekursor.csv
    */

    if (
      templateName === "prekursor"
    ) {

      const master =
        masterPrekursor.find(
          row =>
            normalizeSku(
              row.SKU
            ) ===
            normalizeSku(
              product.sku
            )
        );


      if (master) {

        zatAktif =
          getMasterValue(
            master,
            [
              "Zat Aktif",
              "ZatAktif",
              "ZAT AKTIF",
              "zat_aktif"
            ]
          );


        bentuk =
          getMasterValue(
            master,
            [
              "Bentuk",
              "BENTUK",
              "bentuk"
            ]
          );
      }
    }


    const keterangan =
      [
        product.batch
          ? "Batch: " +
            product.batch
          : "",

        product.expiredDate
          ? "Exp: " +
            product.expiredDate
          : "",

        product.invoice
          ? "Invoice: " +
            product.invoice
          : ""
      ]
        .filter(Boolean)
        .join("<br>");


    rows += `
      <tr>

        <td>
          ${escapeHtml(product.no)}
        </td>

        <td>
          ${escapeHtml(product.description)}
        </td>

        <td>
          ${escapeHtml(product.kemasan)}
        </td>

        <td>
          ${escapeHtml(zatAktif)}
        </td>

        <td>
          ${escapeHtml(bentuk)}
        </td>

        <td>
          ${escapeHtml(product.qty)}
        </td>

        <td>
          ${keterangan}
        </td>

      </tr>
    `;
  }


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

        ${rows}

      </tbody>

    </table>
  `;
}


// =========================================================
// MASTER PREKURSOR
// =========================================================

async function loadPrekursorMaster() {

  const response =
    await fetch(
      MASTER_PREKURSOR_URL
    );


  if (!response.ok) {

    throw new Error(
      "master_prekursor.csv gagal diambil. HTTP " +
      response.status
    );
  }


  const csv =
    await response.text();


  return parseCsv(
    csv
  );
}


// =========================================================
// CSV PARSER
// =========================================================

function parseCsv(csv) {

  const lines =
    String(csv)
      .split(/\r?\n/)
      .filter(
        line =>
          line.trim() !== ""
      );


  if (lines.length < 2) {

    return [];
  }


  const headers =
    parseCsvLine(
      lines[0]
    ).map(
      header =>
        header.trim()
    );


  const result = [];


  for (
    let i = 1;
    i < lines.length;
    i++
  ) {

    const columns =
      parseCsvLine(
        lines[i]
      );


    const row = {};


    for (
      let j = 0;
      j < headers.length;
      j++
    ) {

      row[
        headers[j]
      ] =
        columns[j] ?? "";
    }


    result.push(
      row
    );
  }


  return result;
}


// =========================================================
// CSV LINE
// =========================================================

function parseCsvLine(
  line
) {

  const result = [];

  let current = "";

  let quoted = false;


  for (
    let i = 0;
    i < line.length;
    i++
  ) {

    const char =
      line[i];


    if (char === '"') {

      if (
        quoted &&
        line[i + 1] === '"'
      ) {

        current += '"';

        i++;

      } else {

        quoted =
          !quoted;
      }

    } else if (
      char === "," &&
      !quoted
    ) {

      result.push(
        current.trim()
      );

      current = "";

    } else {

      current += char;
    }
  }


  result.push(
    current.trim()
  );


  return result;
}


// =========================================================
// SKU NORMALIZER
// =========================================================

function normalizeSku(
  value
) {

  return String(
    value ?? ""
  )
    .trim()
    .replace(
      /\.0$/,
      ""
    );
}


// =========================================================
// GET MASTER VALUE
// =========================================================

function getMasterValue(
  row,
  possibleNames
) {

  for (
    const name of possibleNames
  ) {

    if (
      row[name] !== undefined
    ) {

      return String(
        row[name] ?? ""
      ).trim();
    }
  }


  return "";
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


  // data:image/...
  if (
    image.startsWith(
      "data:image/"
    )
  ) {

    return image;
  }


  // <img src="...">
  const match =
    image.match(
      /<img[^>]+src=["']([^"']+)["']/i
    );


  if (match) {

    return match[1];
  }


  // base64 mentah
  image =
    image.replace(
      /\s/g,
      ""
    );


  return (
    "data:image/png;base64," +
    image
  );
}


// =========================================================
// BASE64 → UINT8 ARRAY
// =========================================================

function base64ToUint8Array(
  value
) {

  let base64 =
    String(value)
      .trim();


  /*
    Kalau Power Automate suatu saat
    mengirim:

    data:application/pdf;base64,XXXX

    kita ambil bagian setelah comma.
  */

  if (
    base64.startsWith(
      "data:"
    )
  ) {

    const comma =
      base64.indexOf(",");


    if (comma !== -1) {

      base64 =
        base64.slice(
          comma + 1
        );
    }
  }


  base64 =
    base64.replace(
      /\s/g,
      ""
    );


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
// PDF CSS
// =========================================================

function addPdfCss(
  html
) {

  const css = `

    <style>

      @page {
        size: A4 portrait;
        margin: 0;
      }

      html,
      body {
        width: 210mm;
        min-height: 297mm;
        margin: 0;
        padding: 0;
      }

      .a4-container {
        width: 210mm;
        min-height: 297mm;
        box-sizing: border-box;
        page-break-after: always;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      table th,
      table td {
        border: 1px solid #000;
        padding: 4px;
        vertical-align: top;
      }

      .medicine-table {
        width: 100%;
        table-layout: fixed;
        font-size: 9px;
      }

      .medicine-table th:nth-child(1) {
        width: 6%;
      }

      .medicine-table th:nth-child(2) {
        width: 25%;
      }

      .medicine-table th:nth-child(3) {
        width: 10%;
      }

      .medicine-table th:nth-child(4) {
        width: 19%;
      }

      .medicine-table th:nth-child(5) {
        width: 12%;
      }

      .medicine-table th:nth-child(6) {
        width: 8%;
      }

      .medicine-table th:nth-child(7) {
        width: 20%;
      }

      .signature-container {
        position: relative;
        width: 150px;
        height: 100px;
      }

      .signature-container .stamp {
        position: absolute;
        left: 40px;
        top: 15px;
        width: 85px;
        height: 85px;
        object-fit: contain;
        z-index: 1;
      }

      .signature-container .signature {
        position: absolute;
        left: 0;
        top: 0;
        width: 105px;
        height: 60px;
        object-fit: contain;
        z-index: 2;
      }

    </style>

  `;


  return html.replace(
    "</head>",
    css + "</head>"
  );
}


// =========================================================
// BYTES → BASE64
// =========================================================

function bytesToBase64(
  bytes
) {

  let binary = "";

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
