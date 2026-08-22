```javascript
/*
============================================================
SP GUARDIAN - CLOUDFLARE WORKER
============================================================

FLOW:

Power Automate
    |
    | pdfBase64
    | Satu ... Duabelas
    | ttdBase64
    | stempelBase64
    v
Cloudflare Worker
    |
    +-- GitHub Reguler.html / Prekursor.html
    |
    +-- Workers AI membaca PDF
    |
    +-- Extract jumlah halaman
    |
    +-- Extract tabel PDF
    |
    +-- {{TablePDF}}
    |
    +-- {{TTD&Stemp}}
    |
    +-- Satu ... Duabelas
    |
    +-- Browser Rendering
    |
    v
spBase64
    |
    v
Power Automate

============================================================
CLOUDFLARE BINDINGS
============================================================

AI
BROWSER

============================================================
*/


// ============================================================
// GITHUB TEMPLATE
// ============================================================

const GITHUB_BASE =
  "https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main";

const TEMPLATE_URL = {

  reguler:
    GITHUB_BASE + "/Reguler.html",

  prekursor:
    GITHUB_BASE + "/Prekursor.html"

};


// ============================================================
// MAIN WORKER
// ============================================================

export default {

  async fetch(request, env) {

    try {

      // ------------------------------------------------------
      // METHOD
      // ------------------------------------------------------

      if (request.method !== "POST") {

        return json({

          success: false,

          message:
            "Gunakan HTTP POST."

        }, 405);

      }


      // ------------------------------------------------------
      // CHECK CLOUDFLARE BINDINGS
      // ------------------------------------------------------

      if (!env.AI) {

        throw new Error(
          "Binding Workers AI 'AI' belum tersedia."
        );

      }


      if (!env.BROWSER) {

        throw new Error(
          "Binding Browser Rendering 'BROWSER' belum tersedia."
        );

      }


      // ------------------------------------------------------
      // READ JSON
      // ------------------------------------------------------

      const body =
        await request.json();


      // ------------------------------------------------------
      // TEMPLATE
      // ------------------------------------------------------

      const templateName =
        String(
          body.template ||
          "Reguler"
        )
          .trim()
          .toLowerCase();


      if (
        templateName !== "reguler" &&
        templateName !== "prekursor"
      ) {

        throw new Error(
          "template harus Reguler atau Prekursor."
        );

      }


      // ------------------------------------------------------
      // PDF BASE64
      // ------------------------------------------------------

      if (!body.pdfBase64) {

        throw new Error(
          "pdfBase64 tidak ditemukan."
        );

      }


      const pdfBase64 =
        cleanBase64(
          body.pdfBase64
        );


      const pdfBytes =
        base64ToUint8Array(
          pdfBase64
        );


      if (
        pdfBytes.length < 100
      ) {

        throw new Error(
          "pdfBase64 tidak valid atau PDF kosong."
        );

      }


      // ------------------------------------------------------
      // GET HTML TEMPLATE
      // ------------------------------------------------------

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
          "Gagal mengambil template " +
          templateName +
          ".html dari GitHub. HTTP " +
          templateResponse.status
        );

      }


      let html =
        await templateResponse.text();


      // ------------------------------------------------------
      // EXTRACT PDF
      // ------------------------------------------------------

      const pdfData =
        await extractPDF(
          env,
          pdfBytes
        );


      // ------------------------------------------------------
      // TABLE
      // ------------------------------------------------------

      const tableHTML =
        buildTableHTML(
          pdfData.rows,
          templateName
        );


      // ------------------------------------------------------
      // REPLACE Satu - Duabelas
      // ------------------------------------------------------

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
          body[field] == null
            ? ""
            : String(body[field]);


        html =
          html.split(
            "{{" + field + "}}"
          ).join(
            escapeHTML(value)
          );

      }


      // ------------------------------------------------------
      // TABLE PDF
      // ------------------------------------------------------

      html =
        html.split(
          "{{TablePDF}}"
        ).join(
          tableHTML
        );


      // ------------------------------------------------------
      // TTD + STEMPEL
      // ------------------------------------------------------

      const signatureHTML =
        buildSignatureHTML(
          body.ttdBase64,
          body.stempelBase64
        );


      html =
        html.split(
          "{{TTD&Stemp}}"
        ).join(
          signatureHTML
        );


      // ------------------------------------------------------
      // REMOVE PLACEHOLDER YANG TERSISA
      // ------------------------------------------------------

      html =
        html.replace(
          /\{\{[^{}]+\}\}/g,
          ""
        );


      // ------------------------------------------------------
      // BUILD MULTI PAGE
      // ------------------------------------------------------

      const finalHTML =
        buildMultiPageHTML(
          html,
          pdfData.totalPages
        );


      // ------------------------------------------------------
      // HTML -> PDF
      // ------------------------------------------------------

      const pdfResponse =
        await env.BROWSER.quickAction(
          "pdf",
          {
            html:
              finalHTML,

            pdfOptions: {

              format:
                "A4",

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
        !pdfResponse.ok
      ) {

        const error =
          await pdfResponse.text();


        throw new Error(
          "HTML → PDF gagal: " +
          error
        );

      }


      // ------------------------------------------------------
      // PDF OUTPUT
      // ------------------------------------------------------

      const outputBytes =
        new Uint8Array(
          await pdfResponse.arrayBuffer()
        );


      const outputBase64 =
        bytesToBase64(
          outputBytes
        );


      // ------------------------------------------------------
      // RESPONSE
      // ------------------------------------------------------

      return json({

        success:
          true,

        message:
          "PDF berhasil dibuat.",

        template:
          templateName === "prekursor"
            ? "Prekursor"
            : "Reguler",

        pages:
          pdfData.totalPages,

        tableRows:
          pdfData.rows.length,

        totalQtyShipping:
          pdfData.totalQtyShipping,

        spBase64:
          outputBase64

      });


    } catch (error) {

      return json({

        success:
          false,

        message:
          error &&
          error.message
            ? error.message
            : String(error)

      }, 500);

    }

  }

};


// ============================================================
// EXTRACT PDF
// ============================================================

async function extractPDF(
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
  Workers AI membaca PDF langsung.
  Tidak menggunakan pdfjs-serverless.
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

          }

        }

      }

    );


  const converted =
    Array.isArray(result)
      ? result[0]
      : result;


  if (!converted) {

    throw new Error(
      "Workers AI tidak mengembalikan hasil."
    );

  }


  if (
    converted.format === "error"
  ) {

    throw new Error(
      converted.error ||
      "Workers AI gagal membaca PDF."
    );

  }


  const markdown =
    String(
      converted.data ||
      ""
    );


  if (
    markdown.trim() === ""
  ) {

    throw new Error(
      "PDF terbaca tetapi tidak ada teks yang dapat diekstrak."
    );

  }


  // ----------------------------------------------------------
  // PAGE COUNT
  // ----------------------------------------------------------

  const pageNumbers = [];


  const pageRegex =
    /(?:^|\n)\s*#{1,6}\s*Page\s+(\d+)\b/gi;


  let match;


  while (
    (match =
      pageRegex.exec(markdown))
    !== null
  ) {

    const number =
      Number(
        match[1]
      );


    if (
      Number.isFinite(number)
    ) {

      pageNumbers.push(
        number
      );

    }

  }


  let totalPages =
    pageNumbers.length
      ? Math.max(
          ...pageNumbers
        )
      : 1;


  // ----------------------------------------------------------
  // EXTRACT ROWS
  // ----------------------------------------------------------

  let rows =
    extractMarkdownTable(
      markdown
    );


  // ----------------------------------------------------------
  // FALLBACK TEXT
  // ----------------------------------------------------------

  if (
    rows.length === 0
  ) {

    rows =
      extractPlainTextRows(
        markdown
      );

  }


  // ----------------------------------------------------------
  // REMOVE DUPLICATES
  // ----------------------------------------------------------

  rows =
    removeDuplicateRows(
      rows
    );


  // ----------------------------------------------------------
  // TOTAL
  // ----------------------------------------------------------

  const totalQtyShipping =
    rows.reduce(

      function(sum, row) {

        const value =
          String(
            row.jumlah ||
            ""
          ).replace(
            /[^\d.-]/g,
            ""
          );


        const qty =
          Number(
            value
          );


        if (
          Number.isFinite(qty)
        ) {

          return sum + qty;

        }


        return sum;

      },

      0

    );


  return {

    markdown,

    totalPages,

    rows,

    totalQtyShipping

  };

}


// ============================================================
// EXTRACT MARKDOWN TABLE
// ============================================================

function extractMarkdownTable(
  markdown
) {

  const lines =
    markdown
      .split(/\r?\n/)
      .map(
        function(line) {
          return line.trim();
        }
      )
      .filter(
        Boolean
      );


  const rows = [];


  for (
    let i = 0;
    i < lines.length;
    i++
  ) {

    const headerLine =
      lines[i];


    if (
      !headerLine.includes("|")
    ) {

      continue;

    }


    const header =
      parseMarkdownRow(
        headerLine
      );


    if (
      header.length < 7
    ) {

      continue;

    }


    const normalized =
      header.map(
        normalizeHeader
      );


    const hasNo =
      normalized.some(
        function(x) {
          return x === "no";
        }
      );


    const hasSKU =
      normalized.some(
        function(x) {
          return (
            x.includes(
              "productsku"
            ) ||
            x === "sku"
          );
        }
      );


    const hasDescription =
      normalized.some(
        function(x) {
          return (
            x.includes(
              "productdescription"
            ) ||
            x.includes(
              "description"
            )
          );
        }
      );


    if (
      !hasNo ||
      !hasSKU ||
      !hasDescription
    ) {

      continue;

    }


    // --------------------------------------------------------
    // DATA ROWS
    // --------------------------------------------------------

    for (
      let j = i + 1;
      j < lines.length;
      j++
    ) {

      const line =
        lines[j];


      if (
        !line.includes("|")
      ) {

        if (
          rows.length > 0
        ) {

          break;

        }

        continue;

      }


      const cells =
        parseMarkdownRow(
          line
        );


      // separator
      if (
        cells.every(
          function(cell) {

            return /^[-: ]+$/.test(
              cell
            );

          }
        )
      ) {

        continue;

      }


      if (
        cells.length < 7
      ) {

        continue;

      }


      const row =
        mapColumns(
          cells
        );


      if (row) {

        rows.push(
          row
        );

      }

    }

  }


  return rows;

}


// ============================================================
// MARKDOWN ROW PARSER
// ============================================================

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
      function(cell) {
        return cell
          .trim()
          .replace(
            /<br\s*\/?>/gi,
            " "
          );
      }
    );

}


// ============================================================
// MAP COLUMNS
// ============================================================

function mapColumns(
  cells
) {

  /*
  PDF asli:

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
    cells[0].trim();


  if (
    !/^\d+$/.test(no)
  ) {

    return null;

  }


  return {

    no:
      no,

    sku:
      cells[1].trim(),

    nama:
      cells[2].trim(),

    satuan:
      cells[3].trim(),

    casePack:
      cells[4].trim(),

    jumlah:
      cells[5].trim(),

    batch:
      cells[6].trim(),

    expired:
      cells[7].trim(),

    keterangan:
      cells[8].trim()

  };

}


// ============================================================
// PLAIN TEXT FALLBACK
// ============================================================

function extractPlainTextRows(
  text
) {

  const lines =
    text
      .split(/\r?\n/)
      .map(
        function(line) {
          return line.trim();
        }
      )
      .filter(
        Boolean
      );


  const rows = [];


  for (
    const line of lines
  ) {

    /*
    Kita hanya mulai dari baris:

    1 3039929 ...

    */

    const start =
      line.match(
        /^(\d+)\s+(\d{5,})\s+(.+)$/
      );


    if (!start) {

      continue;

    }


    const no =
      start[1];

    const sku =
      start[2];

    let rest =
      start[3].trim();


    // --------------------------------------------------------
    // INVOICE
    // --------------------------------------------------------

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
      rest
        .substring(
          0,
          invoiceMatch.index
        )
        .trim();


    // --------------------------------------------------------
    // EXPIRED
    // --------------------------------------------------------

    const expiredMatch =
      rest.match(
        /(\d{4}-\d{2}-\d{2})\s*$/
      );


    if (!expiredMatch) {

      continue;

    }


    const expired =
      expiredMatch[1];


    rest =
      rest
        .substring(
          0,
          expiredMatch.index
        )
        .trim();


    // --------------------------------------------------------
    // BATCH
    // --------------------------------------------------------

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
      rest
        .substring(
          0,
          batchMatch.index
        )
        .trim();


    // --------------------------------------------------------
    // TWO NUMBERS
    // --------------------------------------------------------

    const numbers =
      rest.match(
        /(\d+)\s+(\d+)\s*$/
      );


    if (!numbers) {

      continue;

    }


    const casePack =
      numbers[1];

    const qty =
      numbers[2];


    rest =
      rest
        .substring(
          0,
          numbers.index
        )
        .trim();


    // --------------------------------------------------------
    // KEMASAN
    // --------------------------------------------------------

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


// ============================================================
// REMOVE DUPLICATE
// ============================================================

function removeDuplicateRows(
  rows
) {

  const result = [];

  const seen =
    new Set();


  for (
    const row of rows
  ) {

    const key =
      [
        row.no,
        row.sku,
        row.nama
      ].join("|");


    if (
      seen.has(key)
    ) {

      continue;

    }


    seen.add(key);

    result.push(
      row
    );

  }


  return result;

}


// ============================================================
// BUILD TABLE HTML
// ============================================================

function buildTableHTML(
  rows,
  templateName
) {

  if (
    rows.length === 0
  ) {

    return `

<table class="medicine-table">

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

<tr>

<td colspan="5">
Data tabel PDF tidak berhasil diekstrak.
</td>

</tr>

</tbody>

</table>

`;

  }


  // ==========================================================
  // REGULER
  // ==========================================================

  if (
    templateName === "reguler"
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
${escapeHTML(row.no)}
</td>

<td>
${escapeHTML(row.nama)}
</td>

<td>
${escapeHTML(row.satuan)}
</td>

<td>
${escapeHTML(row.jumlah)}
</td>

<td>
${escapeHTML(row.keterangan)}
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


  // ==========================================================
  // PREKURSOR
  // ==========================================================

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

    html += `

<tr>

<td>
${escapeHTML(row.no)}
</td>

<td>
${escapeHTML(row.nama)}
</td>

<td>
${escapeHTML(row.satuan)}
</td>

<td>
</td>

<td>
</td>

<td>
${escapeHTML(row.jumlah)}
</td>

<td>
${escapeHTML(row.keterangan)}
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


// ============================================================
// MULTI PAGE HTML
// ============================================================

function buildMultiPageHTML(
  template,
  totalPages
) {

  let pages = "";


  /*
  Template Reguler.html / Prekursor.html
  sudah memiliki .a4-container.

  Kita ulangi sebanyak jumlah halaman
  PDF upload.
  */


  for (
    let i = 1;
    i <= totalPages;
    i++
  ) {

    pages += `

<div class="pdf-page">

${template}

</div>

`;

  }


  return `

<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8">

<style>

@page {

  size: A4 portrait;

  margin: 0;

}


html,
body {

  margin: 0;

  padding: 0;

  width: 210mm;

  background: #ffffff;

}


.pdf-page {

  width: 210mm;

  height: 297mm;

  position: relative;

  overflow: hidden;

  page-break-after: always;

}


.pdf-page:last-child {

  page-break-after: auto;

}


/* ==========================================================
   TABLE
   ========================================================== */

.medicine-table {

  width: 100%;

  border-collapse: collapse;

  font-family: Arial, sans-serif;

  font-size: 9px;

  table-layout: fixed;

  margin-bottom: 8px;

}


.medicine-table th,
.medicine-table td {

  border: 1px solid #000;

  padding: 4px;

  vertical-align: top;

  word-wrap: break-word;

  overflow-wrap: anywhere;

}


/* ==========================================================
   REGULER
   ========================================================== */

.regular-table th:nth-child(1),
.regular-table td:nth-child(1) {

  width: 7%;

}


.regular-table th:nth-child(2),
.regular-table td:nth-child(2) {

  width: 43%;

}


.regular-table th:nth-child(3),
.regular-table td:nth-child(3) {

  width: 15%;

}


.regular-table th:nth-child(4),
.regular-table td:nth-child(4) {

  width: 10%;

}


.regular-table th:nth-child(5),
.regular-table td:nth-child(5) {

  width: 25%;

}


/* ==========================================================
   PREKURSOR
   ========================================================== */

.precursor-table th:nth-child(1),
.precursor-table td:nth-child(1) {

  width: 6%;

}


.precursor-table th:nth-child(2),
.precursor-table td:nth-child(2) {

  width: 25%;

}


.precursor-table th:nth-child(3),
.precursor-table td:nth-child(3) {

  width: 10%;

}


.precursor-table th:nth-child(4),
.precursor-table td:nth-child(4) {

  width: 19%;

}


.precursor-table th:nth-child(5),
.precursor-table td:nth-child(5) {

  width: 12%;

}


.precursor-table th:nth-child(6),
.precursor-table td:nth-child(6) {

  width: 8%;

}


.precursor-table th:nth-child(7),
.precursor-table td:nth-child(7) {

  width: 20%;

}


/* ==========================================================
   SIGNATURE
   ========================================================== */

.signature-container {

  position: relative;

  width: 150px;

  height: 100px;

}


.signature-container img {

  object-fit: contain;

}


.signature-container .stamp {

  position: absolute;

  left: 40px;

  top: 15px;

  width: 85px;

  height: 85px;

  z-index: 1;

}


.signature-container .signature {

  position: absolute;

  left: 0;

  top: 0;

  width: 105px;

  height: 60px;

  z-index: 2;

}

</style>

</head>

<body>

${pages}

</body>

</html>

`;

}


// ============================================================
// TTD + STEMPEL
// ============================================================

function buildSignatureHTML(
  ttdBase64,
  stempelBase64
) {

  const ttd =
    normalizeImage(
      ttdBase64
    );


  const stamp =
    normalizeImage(
      stempelBase64
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
  class="stamp"
  src="${stamp}"
/>
`
    : ""
}

${
  ttd
    ? `
<img
  class="signature"
  src="${ttd}"
/>
`
    : ""
}

</div>

`;

}


// ============================================================
// NORMALIZE IMAGE
// ============================================================

function normalizeImage(
  value
) {

  if (!value) {

    return "";

  }


  let image =
    String(value)
      .trim();


  // ----------------------------------------------------------
  // <img src="">
  // ----------------------------------------------------------

  const imgMatch =
    image.match(
      /<img[^>]+src=["']([^"']+)["']/i
    );


  if (
    imgMatch
  ) {

    image =
      imgMatch[1];

  }


  // ----------------------------------------------------------
  // DATA IMAGE
  // ----------------------------------------------------------

  if (
    image.startsWith(
      "data:image/"
    )
  ) {

    return image;

  }


  // ----------------------------------------------------------
  // RAW BASE64
  // ----------------------------------------------------------

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


// ============================================================
// CLEAN BASE64
// ============================================================

function cleanBase64(
  value
) {

  let text =
    String(
      value || ""
    ).trim();


  // ----------------------------------------------------------
  // <img src="data:...">
  // ----------------------------------------------------------

  const imgMatch =
    text.match(
      /<img[^>]+src=["']([^"']+)["']/i
    );


  if (
    imgMatch
  ) {

    text =
      imgMatch[1];

  }


  // ----------------------------------------------------------
  // DATA URI
  // ----------------------------------------------------------

  if (
    text.startsWith(
      "data:"
    )
  ) {

    const comma =
      text.indexOf(",");


    if (
      comma !== -1
    ) {

      text =
        text.substring(
          comma + 1
        );

    }

  }


  return text.replace(
    /\s/g,
    ""
  );

}


// ============================================================
// BASE64 -> UINT8ARRAY
// ============================================================

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


// ============================================================
// BYTES -> BASE64
// ============================================================

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


// ============================================================
// ESCAPE HTML
// ============================================================

function escapeHTML(
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


// ============================================================
// HEADER NORMALIZER
// ============================================================

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


// ============================================================
// JSON RESPONSE
// ============================================================

function json(
  data,
  status
) {

  return new Response(

    JSON.stringify(
      data
    ),

    {

      status:
        status || 200,

      headers: {

        "Content-Type":
          "application/json; charset=utf-8"

      }

    }

  );

}
```
