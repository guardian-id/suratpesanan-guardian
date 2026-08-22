```javascript
/*
===========================================================
GUARDIAN SP WORKER
===========================================================

INPUT POWER AUTOMATE:

{
  "template": "Reguler",

  "pdfBase64": "...",

  "Satu": "...",
  "Dua": "...",
  "Tiga": "...",
  "Empat": "...",
  "Lima": "...",
  "Enam": "...",
  "Tujuh": "...",
  "Delapan": "...",
  "Sembilan": "...",
  "Sepuluh": "...",
  "Sebelas": "...",
  "Duabelas": "...",

  "ttdBase64": "...",
  "stempelBase64": "..."
}

===========================================================
REQUIRED CLOUDFLARE BINDINGS

AI       -> Workers AI
BROWSER  -> Browser Rendering

===========================================================
*/

const GITHUB_BASE =
  "https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main";

const TEMPLATE_URL = {
  reguler:
    `${GITHUB_BASE}/Reguler.html`,

  prekursor:
    `${GITHUB_BASE}/Prekursor.html`
};


export default {

  async fetch(request, env) {

    try {

      // ==================================================
      // METHOD
      // ==================================================

      if (request.method !== "POST") {

        return json({

          success: false,

          message:
            "Method harus POST."

        }, 405);
      }


      // ==================================================
      // READ JSON
      // ==================================================

      const body =
        await request.json();


      // ==================================================
      // CHECK BINDINGS
      // ==================================================

      if (!env.AI) {

        throw new Error(
          "Workers AI binding 'AI' belum dipasang di Worker."
        );
      }


      if (!env.BROWSER) {

        throw new Error(
          "Browser Rendering binding 'BROWSER' belum dipasang di Worker."
        );
      }


      // ==================================================
      // TEMPLATE
      // ==================================================

      const templateName =
        String(
          body.template ||
          "Reguler"
        )
          .trim()
          .toLowerCase();


      if (
        !TEMPLATE_URL[
          templateName
        ]
      ) {

        throw new Error(
          "Template harus Reguler atau Prekursor."
        );
      }


      // ==================================================
      // DOWNLOAD TEMPLATE GITHUB
      // ==================================================

      const templateResponse =
        await fetch(
          TEMPLATE_URL[
            templateName
          ]
        );


      if (
        !templateResponse.ok
      ) {

        throw new Error(
          `Template GitHub gagal diambil. HTTP ${templateResponse.status}`
        );
      }


      let template =
        await templateResponse.text();


      // ==================================================
      // PDF INPUT
      // ==================================================

      if (!body.pdfBase64) {

        throw new Error(
          "pdfBase64 belum dikirim dari Power Automate."
        );
      }


      const pdfBytes =
        base64ToUint8Array(
          cleanBase64(
            body.pdfBase64
          )
        );


      // ==================================================
      // EXTRACT PDF
      // ==================================================

      const extracted =
        await extractPdf(
          env,
          pdfBytes
        );


      // ==================================================
      // DATA TABEL
      // ==================================================

      const rows =
        extracted.rows;


      // ==================================================
      // TABLE HTML
      // ==================================================

      const tableHtml =
        buildTable(
          rows,
          templateName
        );


      // ==================================================
      // REPLACE Satu - Duabelas
      // ==================================================

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
          body[field] ??
          "";


        template =
          template
            .split(
              `{{${field}}}`
            )
            .join(
              escapeHtml(
                String(value)
              )
            );
      }


      // ==================================================
      // TABLEPDF
      // ==================================================

      template =
        template
          .split(
            "{{TablePDF}}"
          )
          .join(
            tableHtml
          );


      // ==================================================
      // TTD + STEMPEL
      // ==================================================

      const signatureHtml =
        buildSignature(
          body.ttdBase64,
          body.stempelBase64
        );


      template =
        template
          .split(
            "{{TTD&Stemp}}"
          )
          .join(
            signatureHtml
          );


      // ==================================================
      // REMOVE LEFTOVER PLACEHOLDERS
      // ==================================================

      template =
        template.replace(
          /\{\{[^{}]+\}\}/g,
          ""
        );


      // ==================================================
      // BUILD PAGES
      // ==================================================

      const finalHtml =
        buildPages(
          template,
          extracted.totalPages,
          extracted.pages
        );


      // ==================================================
      // HTML -> PDF
      // ==================================================

      const pdfResult =
        await env.BROWSER.quickAction(
          "pdf",
          {
            html:
              finalHtml,

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

                top: "0",
                right: "0",
                bottom: "0",
                left: "0"

              }

            }

          }
        );


      if (
        !pdfResult.ok
      ) {

        const errorText =
          await pdfResult.text();


        throw new Error(
          `HTML ke PDF gagal: ${errorText}`
        );
      }


      // ==================================================
      // PDF -> BASE64
      // ==================================================

      const outputBytes =
        new Uint8Array(
          await pdfResult.arrayBuffer()
        );


      const spBase64 =
        bytesToBase64(
          outputBytes
        );


      // ==================================================
      // RESPONSE
      // ==================================================

      return json({

        success:
          true,

        message:
          "SP PDF berhasil dibuat.",

        template:
          templateName === "prekursor"
            ? "Prekursor"
            : "Reguler",

        pages:
          extracted.totalPages,

        tableRows:
          rows.length,

        totalQtyShipping:
          extracted.totalQtyShipping,

        spBase64:
          spBase64

      });

    } catch (error) {

      return json({

        success:
          false,

        message:
          error?.message ||
          "Terjadi error."

      }, 500);

    }

  }

};


// ========================================================
// PDF -> MARKDOWN
// ========================================================

async function extractPdf(
  env,
  pdfBytes
) {

  const blob =
    new Blob(
      [pdfBytes],
      {
        type:
          "application/pdf"
      }
    );


  /*
  Cloudflare Workers AI
  membaca PDF langsung.

  Kita sengaja menggunakan markdown,
  bukan text, karena struktur tabel
  lebih mudah dipertahankan.
  */

  const result =
    await env.AI.toMarkdown(

      {
        name:
          "upload.pdf",

        blob:
          blob
      },

      {

        conversionOptions: {

          output: {

            format:
              "markdown"

          },

          pdf: {

            metadata:
              false

          }

        }

      }

    );


  const converted =
    Array.isArray(result)
      ? result[0]
      : result;


  if (
    !converted ||
    converted.format === "error"
  ) {

    throw new Error(
      converted?.error ||
      "PDF gagal dibaca oleh Workers AI."
    );
  }


  const markdown =
    String(
      converted.data ||
      ""
    );


  if (!markdown.trim()) {

    throw new Error(
      "PDF berhasil dibaca tetapi tidak menghasilkan teks."
    );
  }


  // ======================================================
  // PAGE COUNT
  // ======================================================

  const pageMatches =
    markdown.match(
      /(?:^|\n)#{1,6}\s*Page\s+\d+\b/gi
    );


  let totalPages =
    pageMatches
      ? pageMatches.length
      : 1;


  /*
  Kalau converter menghasilkan
  Page 1 ... Page 6,
  kita langsung mendapatkan 6.

  Kalau tidak ada heading Page,
  fallback 1.
  */

  if (
    totalPages < 1
  ) {

    totalPages = 1;

  }


  // ======================================================
  // EXTRACT TABLE
  // ======================================================

  const rows =
    extractRowsFromMarkdown(
      markdown
    );


  // ======================================================
  // TOTAL QTY
  // ======================================================

  const totalQtyShipping =
    rows.reduce(

      (sum, row) => {

        const qty =
          Number(
            String(
              row.jumlah ||
              "0"
            )
              .replace(
                /[^\d.-]/g,
                ""
              )
          );


        return sum +
          (
            Number.isFinite(qty)
              ? qty
              : 0
          );

      },

      0

    );


  // ======================================================
  // PAGE DATA
  // ======================================================

  const pages =
    splitPages(
      markdown,
      totalPages
    );


  return {

    totalPages,

    rows,

    pages,

    totalQtyShipping

  };

}


// ========================================================
// EXTRACT TABLE FROM MARKDOWN
// ========================================================

function extractRowsFromMarkdown(
  markdown
) {

  const lines =
    markdown
      .split(/\r?\n/)
      .map(
        line =>
          line.trim()
      )
      .filter(
        Boolean
      );


  const rows = [];


  // ======================================================
  // METHOD 1
  // MARKDOWN TABLE
  // ======================================================

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {

    const line =
      lines[i];


    if (
      !line.includes("|")
    ) {
      continue;
    }


    const cells =
      parseMarkdownRow(
        line
      );


    if (
      cells.length < 5
    ) {
      continue;
    }


    const normalized =
      cells.map(
        normalizeHeader
      );


    const hasHeader =
      normalized.some(
        x =>
          x === "no"
      ) &&

      normalized.some(
        x =>
          x.includes(
            "productsku"
          )
      ) &&

      normalized.some(
        x =>
          x.includes(
            "productdescription"
          )
      );


    if (!hasHeader) {
      continue;
    }


    // -----------------------------------------------
    // Cari baris data setelah header
    // -----------------------------------------------

    for (
      let j = i + 1;
      j < lines.length;
      j++
    ) {

      const dataLine =
        lines[j];


      if (
        !dataLine.includes("|")
      ) {
        continue;
      }


      const dataCells =
        parseMarkdownRow(
          dataLine
        );


      if (
        dataCells.length <
        cells.length
      ) {
        continue;
      }


      if (
        !/^\d+$/.test(
          dataCells[0]
            .trim()
        )
      ) {

        continue;

      }


      const row =
        mapPdfColumns(
          dataCells
        );


      if (row) {

        rows.push(
          row
        );

      }

    }

  }


  // ======================================================
  // METHOD 2
  // PLAIN TEXT FALLBACK
  // ======================================================

  if (
    rows.length === 0
  ) {

    const fallback =
      extractRowsFromPlainText(
        markdown
      );


    rows.push(
      ...fallback
    );

  }


  // ======================================================
  // REMOVE DUPLICATES
  // ======================================================

  const unique =
    [];

  const seen =
    new Set();


  for (
    const row of rows
  ) {

    const key =
      `${row.no}|${row.sku}|${row.nama}`;


    if (
      seen.has(key)
    ) {
      continue;
    }


    seen.add(key);

    unique.push(
      row
    );

  }


  return unique;

}


// ========================================================
// MARKDOWN ROW
// ========================================================

function parseMarkdownRow(
  line
) {

  let value =
    line.trim();


  if (
    value.startsWith("|")
  ) {

    value =
      value.substring(1);

  }


  if (
    value.endsWith("|")
  ) {

    value =
      value.substring(
        0,
        value.length - 1
      );

  }


  return value
    .split("|")
    .map(
      x =>
        x.trim()
    )
    .filter(
      (_, index) =>
        true
    );

}


// ========================================================
// MAP PDF COLUMNS
// ========================================================

function mapPdfColumns(
  cells
) {

  /*
  Struktur asli PDF:

  0 No
  1 Product SKU
  2 Product Description
  3 Kemasan
  4 Case Pack
  5 Qty Shipping
  6 Batch Number
  7 Expired Date
  8 Invoice No
  */


  if (
    cells.length < 9
  ) {

    return null;

  }


  const no =
    cells[0];


  if (
    !/^\d+$/.test(
      String(no).trim()
    )
  ) {

    return null;

  }


  return {

    no:
      no.trim(),

    sku:
      cells[1]?.trim() ||
      "",

    nama:
      cells[2]?.trim() ||
      "",

    satuan:
      cells[3]?.trim() ||
      "",

    casePack:
      cells[4]?.trim() ||
      "",

    jumlah:
      cells[5]?.trim() ||
      "",

    batch:
      cells[6]?.trim() ||
      "",

    expired:
      cells[7]?.trim() ||
      "",

    keterangan:
      cells[8]?.trim() ||
      ""

  };

}


// ========================================================
// PLAIN TEXT FALLBACK
// ========================================================

function extractRowsFromPlainText(
  text
) {

  const lines =
    text
      .split(/\r?\n/)
      .map(
        x =>
          x.trim()
      )
      .filter(
        Boolean
      );


  const rows = [];


  for (
    const line of lines
  ) {

    /*
    Contoh:

    1 3039929 A+ LUBRICATING...
    */

    const match =
      line.match(
        /^(\d+)\s+(\d{5,})\s+(.+)$/
      );


    if (!match) {
      continue;
    }


    const no =
      match[1];


    const sku =
      match[2];


    let rest =
      match[3];


    /*
    Ambil Invoice No
    sebagai angka terakhir.
    */

    const invoiceMatch =
      rest.match(
        /(\d{6,})\s*$/
      );


    if (!invoiceMatch) {
      continue;
    }


    const invoice =
      invoiceMatch[1];


    rest =
      rest.substring(
        0,
        invoiceMatch.index
      ).trim();


    /*
    Expired Date
    */

    const dateMatch =
      rest.match(
        /(\d{4}-\d{2}-\d{2})\s*$/
      );


    if (!dateMatch) {
      continue;
    }


    const expired =
      dateMatch[1];


    rest =
      rest.substring(
        0,
        dateMatch.index
      ).trim();


    /*
    Batch Number
    */

    const batchMatch =
      rest.match(
        /(\S+)\s*$/
      );


    if (!batchMatch) {
      continue;
    }


    const batch =
      batchMatch[1];


    rest =
      rest.substring(
        0,
        batchMatch.index
      ).trim();


    /*
    Qty Shipping + Case Pack

    Contoh:
    ... BOTOL 2 2

    Kita ambil dua angka
    terakhir.
    */

    const qtyMatch =
      rest.match(
        /(\d+)\s+(\d+)\s*$/
      );


    if (!qtyMatch) {
      continue;
    }


    const qty =
      qtyMatch[1];


    const casePack =
      qtyMatch[2];


    rest =
      rest.substring(
        0,
        qtyMatch.index
      ).trim();


    /*
    Kemasan adalah token terakhir.
    */

    const packageMatch =
      rest.match(
        /(\S+)\s*$/
      );


    if (!packageMatch) {
      continue;
    }


    const satuan =
      packageMatch[1];


    const nama =
      rest
        .substring(
          0,
          packageMatch.index
        )
        .trim();


    rows.push({

      no,

      sku,

      nama,

      satuan,

      casePack,

      jumlah:
        qty,

      batch,

      expired,

      keterangan:
        invoice

    });

  }


  return rows;

}


// ========================================================
// BUILD TABLE
// ========================================================

function buildTable(
  rows,
  templateName
) {

  if (
    !rows.length
  ) {

    return `

<div class="table-empty">
Tidak ada data tabel yang berhasil dibaca dari PDF upload.
</div>

`;

  }


  // ======================================================
  // REGULER
  // ======================================================

  if (
    templateName ===
    "reguler"
  ) {

    let html = `

<table class="medicine-table regular-table">

<thead>

<tr>

<th>No</th>

<th>Nama Obat</th>

<th>Satuan</th>

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
${escapeHtml(row.nama)}
</td>

<td>
${escapeHtml(row.satuan)}
</td>

<td>
${escapeHtml(row.jumlah)}
</td>

<td>
${escapeHtml(row.keterangan)}
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


  // ======================================================
  // PREKURSOR
  // ======================================================

  let html = `

<table class="medicine-table precursor-table">

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

    /*
    Untuk sekarang:

    Zat Aktif = kosong
    Bentuk    = kosong

    Nanti kita sambungkan
    ke master_prekursor.csv
    berdasarkan SKU.
    */

    html += `

<tr>

<td>
${escapeHtml(row.no)}
</td>

<td>
${escapeHtml(row.nama)}
</td>

<td>
${escapeHtml(row.satuan)}
</td>

<td>
</td>

<td>
</td>

<td>
${escapeHtml(row.jumlah)}
</td>

<td>
${escapeHtml(row.keterangan)}
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


// ========================================================
// SPLIT PAGE
// ========================================================

function splitPages(
  markdown,
  totalPages
) {

  const result = [];


  for (
    let i = 1;
    i <= totalPages;
    i++
  ) {

    const regex =
      new RegExp(
        `(?:^|\\n)#{1,6}\\s*Page\\s+${i}\\b`,
        "i"
      );


    const match =
      markdown.match(
        regex
      );


    result.push({

      page:
        i,

      exists:
        Boolean(match)

    });

  }


  return result;

}


// ========================================================
// BUILD HTML PAGES
// ========================================================

function buildPages(
  template,
  totalPages,
  pages
) {

  let pageHtml =
    "";


  /*
  IMPORTANT:

  Template HTML bosku sudah mempunyai
  .a4-container.

  Kita buat satu template per halaman.
  */

  for (
    let i = 0;
    i < totalPages;
    i++
  ) {

    pageHtml += `

<section class="pdf-page">

${template}

</section>

`;

  }


  return `

<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8">

<style>

@page {

  size:
    A4 portrait;

  margin:
    0;

}


html,
body {

  margin:
    0;

  padding:
    0;

  width:
    210mm;

  background:
    #ffffff;

}


.pdf-page {

  position:
    relative;

  width:
    210mm;

  height:
    297mm;

  overflow:
    hidden;

  page-break-after:
    always;

  box-sizing:
    border-box;

}


.pdf-page:last-child {

  page-break-after:
    auto;

}


/* ============================================
   TABLE
   ============================================ */

.medicine-table {

  width:
    100%;

  border-collapse:
    collapse;

  font-family:
    Arial,
    sans-serif;

  font-size:
    9px;

  table-layout:
    fixed;

  margin-bottom:
    8px;

}


.medicine-table th,
.medicine-table td {

  border:
    1px solid #000000;

  padding:
    4px;

  vertical-align:
    top;

  word-wrap:
    break-word;

  overflow-wrap:
    anywhere;

}


/* ============================================
   REGULER
   ============================================ */

.regular-table
th:nth-child(1),
.regular-table
td:nth-child(1) {

  width:
    7%;

}


.regular-table
th:nth-child(2),
.regular-table
td:nth-child(2) {

  width:
    43%;

}


.regular-table
th:nth-child(3),
.regular-table
td:nth-child(3) {

  width:
    15%;

}


.regular-table
th:nth-child(4),
.regular-table
td:nth-child(4) {

  width:
    10%;

}


.regular-table
th:nth-child(5),
.regular-table
td:nth-child(5) {

  width:
    25%;

}


/* ============================================
   PREKURSOR
   ============================================ */

.precursor-table
th:nth-child(1),
.precursor-table
td:nth-child(1) {

  width:
    6%;

}


.precursor-table
th:nth-child(2),
.precursor-table
td:nth-child(2) {

  width:
    25%;

}


.precursor-table
th:nth-child(3),
.precursor-table
td:nth-child(3) {

  width:
    10%;

}


.precursor-table
th:nth-child(4),
.precursor-table
td:nth-child(4) {

  width:
    19%;

}


.precursor-table
th:nth-child(5),
.precursor-table
td:nth-child(5) {

  width:
    12%;

}


.precursor-table
th:nth-child(6),
.precursor-table
td:nth-child(6) {

  width:
    8%;

}


.precursor-table
th:nth-child(7),
.precursor-table
td:nth-child(7) {

  width:
    20%;

}


/* ============================================
   EMPTY
   ============================================ */

.table-empty {

  border:
    1px solid #000;

  padding:
    8px;

  font-size:
    9px;

}


/* ============================================
   SIGNATURE
   ============================================ */

.signature-container {

  position:
    relative;

  width:
    150px;

  height:
    100px;

}


.signature-container
.stamp {

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


.signature-container
.signature {

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

</head>

<body>

${pageHtml}

</body>

</html>

`;

}


// ========================================================
// TTD + STEMPEL
// ========================================================

function buildSignature(
  ttdBase64,
  stampBase64
) {

  const ttd =
    normalizeImage(
      ttdBase64
    );


  const stamp =
    normalizeImage(
      stampBase64
    );


  if (
    !ttd &&
    !stamp
  ) {

    return "";

  }


  return `

<div class="signature-container">

${
  stamp
    ? `
<img
  src="${stamp}"
  class="stamp"
/>
`
    : ""
}

${
  ttd
    ? `
<img
  src="${ttd}"
  class="signature"
/>
`
    : ""
}

</div>

`;

}


// ========================================================
// BASE64 CLEAN
// ========================================================

function cleanBase64(
  value
) {

  let v =
    String(value || "")
      .trim();


  // -----------------------------------------------
  // DATA URI
  // -----------------------------------------------

  if (
    v.startsWith(
      "data:"
    )
  ) {

    const comma =
      v.indexOf(",");


    if (
      comma !== -1
    ) {

      v =
        v.substring(
          comma + 1
        );

    }

  }


  // -----------------------------------------------
  // IMG TAG
  // -----------------------------------------------

  const imgMatch =
    v.match(
      /<img[^>]+src=["']([^"']+)["']/i
    );


  if (
    imgMatch
  ) {

    const src =
      imgMatch[1];


    const comma =
      src.indexOf(",");


    if (
      comma !== -1
    ) {

      v =
        src.substring(
          comma + 1
        );

    }

  }


  return v.replace(
    /\s/g,
    ""
  );

}


// ========================================================
// BASE64 -> UINT8ARRAY
// ========================================================

function base64ToUint8Array(
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


// ========================================================
// IMAGE NORMALIZE
// ========================================================

function normalizeImage(
  value
) {

  if (!value) {
    return "";
  }


  let image =
    String(value)
      .trim();


  if (
    image.startsWith(
      "data:image/"
    )
  ) {

    return image;

  }


  const img =
    image.match(
      /<img[^>]+src=["']([^"']+)["']/i
    );


  if (
    img
  ) {

    return img[1];

  }


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


// ========================================================
// HTML ESCAPE
// ========================================================

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


// ========================================================
// BYTES -> BASE64
// ========================================================

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


// ========================================================
// HEADER NORMALIZER
// ========================================================

function normalizeHeader(
  value
) {

  return String(
    value || ""
  )

    .toLowerCase()

    .replace(
      /[^a-z0-9]/g,
      ""
    );

}


// ========================================================
// JSON RESPONSE
// ========================================================

function json(
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
```
