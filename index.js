```javascript
import { getDocument } from "pdfjs-serverless";

const GITHUB_RAW_BASE =
  "https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main";

const REGULER_HTML_URL =
  `${GITHUB_RAW_BASE}/Reguler.html`;

const PREKURSOR_HTML_URL =
  `${GITHUB_RAW_BASE}/Prekursor.html`;

const MASTER_PREKURSOR_URL =
  `${GITHUB_RAW_BASE}/master_prekursor.csv`;


export default {

  async fetch(request, env) {

    // =========================================================
    // GET = HEALTH CHECK
    // =========================================================

    if (request.method === "GET") {

      return jsonResponse({
        success: true,
        message: "SP GUARDIAN WORKER OK",
        worker: "suratpesanan-guardian",
        version: "FINAL-HTML-1"
      });

    }


    // =========================================================
    // ONLY POST
    // =========================================================

    if (request.method !== "POST") {

      return jsonResponse({
        success: false,
        error: "Method not allowed"
      }, 405);

    }


    try {

      // =======================================================
      // READ JSON
      // =======================================================

      const body = await request.json();


      if (!body || typeof body !== "object") {

        return jsonResponse({
          success: false,
          error: "Invalid request body"
        }, 400);

      }


      // =======================================================
      // INPUT
      // =======================================================

      const {

        pdfBase64,
        ttdBase64,
        stempelBase64,
        template,

        Satu,
        Dua,
        Tiga,
        Empat,
        Lima,
        Enam,
        Tujuh,
        Delapan,
        Sembilan,
        Sepuluh,
        Sebelas,
        Duabelas

      } = body;


      if (!pdfBase64) {

        return jsonResponse({
          success: false,
          error: "pdfBase64 is required"
        }, 400);

      }


      // =======================================================
      // TEMPLATE
      // =======================================================

      const templateName =
        String(template || "Reguler")
          .trim()
          .toLowerCase();

      const isPrekursor =
        templateName === "prekursor";


      // =======================================================
      // HEADER VALUES
      // =======================================================

      const values = {

        Satu: Satu ?? "",
        Dua: Dua ?? "",
        Tiga: Tiga ?? "",
        Empat: Empat ?? "",
        Lima: Lima ?? "",
        Enam: Enam ?? "",
        Tujuh: Tujuh ?? "",
        Delapan: Delapan ?? "",
        Sembilan: Sembilan ?? "",
        Sepuluh: Sepuluh ?? "",
        Sebelas: Sebelas ?? "",
        Duabelas: Duabelas ?? ""

      };


      // =======================================================
      // PDF SOURCE
      // =======================================================

      const pdfBytes =
        base64ToUint8Array(pdfBase64);


      // =======================================================
      // EXTRACT SOURCE PDF TABLE
      // =======================================================

      const sourceRows =
        await extractProductRows(pdfBytes);


      // =======================================================
      // PREKURSOR LOOKUP
      // =======================================================

      let masterData = [];

      if (isPrekursor) {

        masterData =
          await loadPrekursorMaster();

      }


      // =======================================================
      // BUILD FINAL TABLE
      // =======================================================

      const tableRows = [];


      for (const row of sourceRows) {

        let zatAktif = "";
        let bentuk = "";

        if (isPrekursor) {

          const lookup =
            findPrekursor(
              masterData,
              row.productSKU
            );

          if (lookup) {

            zatAktif =
              lookup.zatAktif;

            bentuk =
              lookup.bentuk;

          }

        }


        tableRows.push({

          no:
            row.no,

          productSKU:
            row.productSKU,

          namaObat:
            row.productDescription,

          satuan:
            row.kemasan,

          jumlah:
            row.qty,

          keterangan:
            row.invoiceNo,

          zatAktif,

          bentuk

        });

      }


      // =======================================================
      // LOAD HTML TEMPLATE
      // =======================================================

      const templateURL =
        isPrekursor
          ? PREKURSOR_HTML_URL
          : REGULER_HTML_URL;


      const htmlResponse =
        await fetch(templateURL);


      if (!htmlResponse.ok) {

        throw new Error(
          `Template HTML gagal diambil: ${htmlResponse.status}`
        );

      }


      let html =
        await htmlResponse.text();


      // =======================================================
      // BUILD TABLE
      // =======================================================

      const tableHTML =
        isPrekursor
          ? buildPrekursorTable(tableRows)
          : buildRegulerTable(tableRows);


      // =======================================================
      // TTD + STEMPEL
      // =======================================================

      const signatureHTML =
        buildSignatureHTML(
          ttdBase64,
          stempelBase64
        );


      // =======================================================
      // REPLACE BASIC PLACEHOLDERS
      // =======================================================

      html =
        replacePlaceholder(
          html,
          "Satu",
          values.Satu
        );

      html =
        replacePlaceholder(
          html,
          "Dua",
          values.Dua
        );

      html =
        replacePlaceholder(
          html,
          "Tiga",
          values.Tiga
        );

      html =
        replacePlaceholder(
          html,
          "Empat",
          values.Empat
        );

      html =
        replacePlaceholder(
          html,
          "Lima",
          values.Lima
        );

      html =
        replacePlaceholder(
          html,
          "Enam",
          values.Enam
        );

      html =
        replacePlaceholder(
          html,
          "Tujuh",
          values.Tujuh
        );

      html =
        replacePlaceholder(
          html,
          "Delapan",
          values.Delapan
        );

      html =
        replacePlaceholder(
          html,
          "Sembilan",
          values.Sembilan
        );

      html =
        replacePlaceholder(
          html,
          "Sepuluh",
          values.Sepuluh
        );

      html =
        replacePlaceholder(
          html,
          "Sebelas",
          values.Sebelas
        );

      html =
        replacePlaceholder(
          html,
          "Duabelas",
          values.Duabelas
        );


      // =======================================================
      // TABLE + SIGNATURE
      // =======================================================

      html =
        html.replaceAll(
          "{{TablePDF}}",
          tableHTML
        );


      html =
        html.replaceAll(
          "{{TTD&Stemp}}",
          signatureHTML
        );


      // =======================================================
      // FORCE A4
      // =======================================================

      html =
        html.replace(
          "</head>",
          `
          <style>

            @page {
              size: A4 portrait;
              margin: 0;
            }

            html,
            body {
              width: 210mm !important;
              min-width: 210mm !important;
              max-width: 210mm !important;
              margin: 0 !important;
              padding: 0 !important;
            }

            .a4-container {
              width: 210mm !important;
              height: 297mm !important;
              min-height: 297mm !important;
              max-height: 297mm !important;
              overflow: hidden !important;
              page-break-after: always;
            }

            table {
              page-break-inside: auto;
            }

            tr {
              page-break-inside: avoid;
              page-break-after: auto;
            }

          </style>
          </head>
          `
        );


      // =======================================================
      // RENDER HTML → PDF
      // =======================================================

      const pdfResponse =
        await env.BROWSER.quickAction(
          "pdf",
          {
            html,

            waitForTimeout: 100,

            printBackground: true,

            format: "A4",

            margin: {
              top: "0mm",
              right: "0mm",
              bottom: "0mm",
              left: "0mm"
            }
          }
        );


      if (!pdfResponse.ok) {

        const errorText =
          await pdfResponse.text();

        throw new Error(
          `Browser PDF gagal: ${pdfResponse.status} ${errorText}`
        );

      }


      // =======================================================
      // PDF RESULT
      // =======================================================

      const outputBytes =
        new Uint8Array(
          await pdfResponse.arrayBuffer()
        );


      const outputBase64 =
        uint8ArrayToBase64(
          outputBytes
        );


      // =======================================================
      // RETURN
      // =======================================================

      return jsonResponse({

        success: true,

        template:
          isPrekursor
            ? "Prekursor"
            : "Reguler",

        sourceRows:
          sourceRows.length,

        outputRows:
          tableRows.length,

        prekursorLookup:
          isPrekursor
            ? tableRows.filter(
                row =>
                  row.zatAktif ||
                  row.bentuk
              ).length
            : 0,

        pdfBase64:
          outputBase64

      });

    }

    catch (error) {

      return jsonResponse({

        success: false,

        error:
          error?.message ||
          String(error),

        stack:
          error?.stack ||
          null

      }, 500);

    }

  }

};


// =============================================================
// EXTRACT PRODUCT ROWS FROM SOURCE PDF
// =============================================================

async function extractProductRows(pdfBytes) {

  const document =
    await getDocument({

      data: pdfBytes,

      useSystemFonts: true

    }).promise;


  const allRows = [];


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
        .map(item => {

          const transform =
            item.transform || [];

          return {

            text:
              item.str.trim(),

            x:
              Number(transform[4] || 0),

            y:
              Number(transform[5] || 0)

          };

        });


    const lines =
      groupTextIntoLines(items);


    for (const line of lines) {

      const row =
        parseProductLine(line);


      if (row) {

        allRows.push(row);

      }

    }

  }


  return allRows;

}


// =============================================================
// GROUP PDF TEXT INTO VISUAL LINES
// =============================================================

function groupTextIntoLines(items) {

  const lines = [];


  for (const item of items) {

    let target = null;


    for (const line of lines) {

      if (
        Math.abs(
          line.y - item.y
        ) <= 3
      ) {

        target = line;
        break;

      }

    }


    if (!target) {

      target = {

        y: item.y,

        items: []

      };

      lines.push(target);

    }


    target.items.push(item);

  }


  lines.sort(
    (a, b) =>
      b.y - a.y
  );


  return lines.map(
    line =>
      line.items
        .sort(
          (a, b) =>
            a.x - b.x
        )
        .map(
          item =>
            item.text
        )
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
  );

}


// =============================================================
// PARSE PRODUCT LINE
// =============================================================

function parseProductLine(line) {

  /*
   * Expected source structure:
   *
   * No
   * Product SKU
   * Product Description
   * Kemasan
   * Case Pack
   * Qty
   * Shipping Batch Number
   * Expired Date
   * Invoice No
   *
   * Example:
   *
   * 1 3039929 A+ LUBRICATING AND REWETTING DROPS
   * 10ML BOTOL 2 2 255...
   */


  const match =
    line.match(
      /^(\d+)\s+(\d{4,})\s+(.+?)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)$/i
    );


  if (!match) {
    return null;
  }


  const no =
    match[1];

  const productSKU =
    match[2];

  const remainder =
    match[3].trim();

  const casePack =
    match[4];

  const qty =
    match[5];

  const shippingBatch =
    match[6];

  const expiredDate =
    match[7];

  const invoiceNo =
    match[8];


  /*
   * Kemasan is normally the last token
   * before Case Pack.
   *
   * Examples:
   * BOTOL
   * BOX
   * TUBE
   * KAPSUL
   * TABLET
   */


  const kemasanMatch =
    remainder.match(
      /^(.*?)(?:\s+)(BOTOL|BOX|TUBE|TABLET|KAPSUL|KAPLET|SACHET|VIAL|AMPUL|STRIP|PCS|UNIT|ROLL|CAN|JAR|BAG|BOTTLE)$/i
    );


  let productDescription =
    remainder;

  let kemasan =
    "";


  if (kemasanMatch) {

    productDescription =
      kemasanMatch[1].trim();

    kemasan =
      kemasanMatch[2].trim();

  }


  return {

    no,

    productSKU,

    productDescription,

    kemasan,

    casePack,

    qty,

    shippingBatch,

    expiredDate,

    invoiceNo

  };

}


// =============================================================
// REGULER TABLE
// =============================================================

function buildRegulerTable(rows) {

  if (!rows.length) {

    return `
      <table>
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
              Tidak ada data obat.
            </td>
          </tr>
        </tbody>
      </table>
    `;

  }


  const body =
    rows.map(row => {

      return `
        <tr>
          <td>${escapeHTML(row.no)}</td>
          <td>${escapeHTML(row.namaObat)}</td>
          <td>${escapeHTML(row.satuan)}</td>
          <td>${escapeHTML(row.jumlah)}</td>
          <td>${escapeHTML(row.keterangan)}</td>
        </tr>
      `;

    }).join("");


  return `
    <table>
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
        ${body}
      </tbody>
    </table>
  `;

}


// =============================================================
// PREKURSOR TABLE
// =============================================================

function buildPrekursorTable(rows) {

  if (!rows.length) {

    return `
      <table>
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
              Tidak ada data obat.
            </td>
          </tr>

        </tbody>

      </table>
    `;

  }


  const body =
    rows.map(row => {

      return `
        <tr>

          <td>
            ${escapeHTML(row.no)}
          </td>

          <td>
            ${escapeHTML(row.namaObat)}
          </td>

          <td>
            ${escapeHTML(row.satuan)}
          </td>

          <td>
            ${escapeHTML(row.zatAktif)}
          </td>

          <td>
            ${escapeHTML(row.bentuk)}
          </td>

          <td>
            ${escapeHTML(row.jumlah)}
          </td>

          <td>
            ${escapeHTML(row.keterangan)}
          </td>

        </tr>
      `;

    }).join("");


  return `
    <table>

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

        ${body}

      </tbody>

    </table>
  `;

}


// =============================================================
// LOAD PREKURSOR MASTER
// =============================================================

async function loadPrekursorMaster() {

  const response =
    await fetch(
      MASTER_PREKURSOR_URL
    );


  if (!response.ok) {

    throw new Error(
      `master_prekursor.csv gagal diambil: ${response.status}`
    );

  }


  const csv =
    await response.text();


  return parsePrekursorCSV(csv);

}


// =============================================================
// FIND PREKURSOR
// =============================================================

function findPrekursor(
  master,
  sku
) {

  const target =
    normalizeSKU(sku);


  return master.find(
    row =>
      normalizeSKU(
        row.sku
      ) === target
  ) || null;

}


// =============================================================
// PREKURSOR CSV
// =============================================================

function parsePrekursorCSV(csv) {

  const lines =
    csv
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .filter(
        line =>
          line.trim() !== ""
      );


  if (lines.length < 2) {
    return [];
  }


  const headers =
    parseCSVLine(
      lines[0]
    ).map(
      h =>
        h.trim()
          .toLowerCase()
    );


  const skuIndex =
    headers.findIndex(
      h =>
        h.includes("sku")
    );


  const zatAktifIndex =
    headers.findIndex(
      h =>
        h.includes("zat aktif")
    );


  const bentukIndex =
    headers.findIndex(
      h =>
        h.includes("bentuk")
    );


  const result = [];


  for (
    let i = 1;
    i < lines.length;
    i++
  ) {

    const columns =
      parseCSVLine(
        lines[i]
      );


    result.push({

      sku:
        columns[skuIndex] ?? "",

      zatAktif:
        columns[zatAktifIndex] ?? "",

      bentuk:
        columns[bentukIndex] ?? ""

    });

  }


  return result;

}


// =============================================================
// CSV LINE
// =============================================================

function parseCSVLine(line) {

  const result = [];

  let current = "";

  let insideQuotes =
    false;


  for (
    let i = 0;
    i < line.length;
    i++
  ) {

    const char =
      line[i];


    if (char === '"') {

      if (
        insideQuotes &&
        line[i + 1] === '"'
      ) {

        current += '"';

        i++;

      } else {

        insideQuotes =
          !insideQuotes;

      }

    }

    else if (
      char === "," &&
      !insideQuotes
    ) {

      result.push(
        current.trim()
      );

      current = "";

    }

    else {

      current += char;

    }

  }


  result.push(
    current.trim()
  );


  return result;

}


// =============================================================
// TTD + STEMPEL HTML
// =============================================================

function buildSignatureHTML(
  ttdBase64,
  stempelBase64
) {

  if (
    !ttdBase64 &&
    !stempelBase64
  ) {

    return "";

  }


  let ttd = "";

  let stempel = "";


  if (stempelBase64) {

    stempel = `
      <img
        src="${normalizeImageData(stempelBase64)}"
        style="
          position:absolute;
          left:0;
          top:15px;
          width:85px;
          height:85px;
          object-fit:contain;
          z-index:1;
        "
      />
    `;

  }


  if (ttdBase64) {

    ttd = `
      <img
        src="${normalizeImageData(ttdBase64)}"
        style="
          position:absolute;
          left:45px;
          top:25px;
          width:110px;
          height:55px;
          object-fit:contain;
          z-index:2;
        "
      />
    `;

  }


  return `
    <div
      style="
        position:relative;
        width:170px;
        height:100px;
        margin-top:-2cm;
      "
    >
      ${stempel}
      ${ttd}
    </div>
  `;

}


// =============================================================
// IMAGE NORMALIZER
// =============================================================

function normalizeImageData(value) {

  let clean =
    String(value)
      .trim();


  if (
    clean.startsWith(
      "<img"
    )
  ) {

    const match =
      clean.match(
        /src=["']([^"']+)["']/i
      );


    if (match) {

      return match[1];

    }

  }


  if (
    clean.startsWith(
      "data:image/"
    )
  ) {

    return clean;

  }


  return `
    data:image/png;base64,${clean}
  `;

}


// =============================================================
// PLACEHOLDER
// =============================================================

function replacePlaceholder(
  html,
  name,
  value
) {

  return html.replaceAll(
    `{{${name}}}`,
    escapeHTML(
      String(value ?? "")
    )
  );

}


// =============================================================
// ESCAPE HTML
// =============================================================

function escapeHTML(value) {

  return String(value ?? "")
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


// =============================================================
// SKU NORMALIZER
// =============================================================

function normalizeSKU(value) {

  return String(
    value ?? ""
  )
    .replace(
      /\D/g,
      ""
    )
    .trim();

}


// =============================================================
// BASE64 → UINT8ARRAY
// =============================================================

function base64ToUint8Array(
  base64
) {

  const clean =
    String(base64)
      .replace(
        /^data:.*?;base64,/i,
        ""
      )
      .replace(
        /\s/g,
        ""
      );


  const binary =
    atob(clean);


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


// =============================================================
// UINT8ARRAY → BASE64
// =============================================================

function uint8ArrayToBase64(
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


  return btoa(binary);

}


// =============================================================
// JSON RESPONSE
// =============================================================

function jsonResponse(
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

        "content-type":
          "application/json; charset=UTF-8"

      }

    }
  );

}
```
