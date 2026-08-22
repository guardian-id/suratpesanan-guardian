import puppeteer from "@cloudflare/puppeteer";
import { PDFDocument } from "pdf-lib";

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
    // GET - HEALTH CHECK
    // =========================================================

    if (request.method === "GET") {
      return jsonResponse({
        success: true,
        message: "SP GUARDIAN WORKER OK",
        worker: "suratpesanan-guardian",
        version: "FINAL-HTML-2-TEMPLATE"
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


      // =======================================================
      // TEMPLATE
      // =======================================================

      const selectedTemplate =
        String(template || "Reguler")
          .trim()
          .toLowerCase();

      const isPrekursor =
        selectedTemplate === "prekursor";


      // =======================================================
      // SELECT HTML TEMPLATE
      // =======================================================

      const templateUrl =
        isPrekursor
          ? PREKURSOR_HTML_URL
          : REGULER_HTML_URL;


      // =======================================================
      // GET HTML FROM GITHUB
      // =======================================================

      const templateResponse =
        await fetch(templateUrl);


      if (!templateResponse.ok) {

        throw new Error(
          `Template tidak ditemukan: ${templateUrl} (${templateResponse.status})`
        );

      }


      let html =
        await templateResponse.text();


      // =======================================================
      // DATA
      // =======================================================

      const values = {

        Satu:
          cleanValue(Satu),

        Dua:
          cleanValue(Dua),

        Tiga:
          cleanValue(Tiga),

        Empat:
          cleanValue(Empat),

        Lima:
          cleanValue(Lima),

        Enam:
          cleanValue(Enam),

        Tujuh:
          cleanValue(Tujuh),

        Delapan:
          cleanValue(Delapan),

        Sembilan:
          cleanValue(Sembilan),

        Sepuluh:
          cleanValue(Sepuluh),

        Sebelas:
          cleanValue(Sebelas),

        Duabelas:
          cleanValue(Duabelas)

      };


      // =======================================================
      // PREKURSOR LOOKUP
      // =======================================================

      let prekursorLookup = [];


      if (isPrekursor) {

        const csvResponse =
          await fetch(MASTER_PREKURSOR_URL);


        if (!csvResponse.ok) {

          throw new Error(
            `master_prekursor.csv gagal diambil (${csvResponse.status})`
          );

        }


        const csvText =
          await csvResponse.text();


        prekursorLookup =
          parseCSV(csvText);


        // -----------------------------------------------------
        // LOOKUP BERDASARKAN SEMUA DATA YANG DIKIRIM
        // -----------------------------------------------------

        const lookupRows = [];


        for (const key of Object.keys(values)) {

          const value =
            values[key];

          if (!value) {
            continue;
          }


          const found =
            findProduct(
              prekursorLookup,
              value
            );


          if (found) {

            lookupRows.push({
              inputField: key,
              product: found
            });

          }

        }


        // -----------------------------------------------------
        // MASUKKAN HASIL LOOKUP KE HTML
        // -----------------------------------------------------

        if (lookupRows.length > 0) {

          const first =
            lookupRows[0].product;


          html =
            replaceAll(
              html,
              "{{ZAT_AKTIF}}",
              first["Zat Aktif"] || ""
            );


          html =
            replaceAll(
              html,
              "{{BENTUK}}",
              first["Bentuk"] || ""
            );

        }

      }


      // =======================================================
      // REPLACE PLACEHOLDERS
      // =======================================================

      html =
        replaceAll(
          html,
          "{{Satu}}",
          escapeHtml(values.Satu)
        );


      html =
        replaceAll(
          html,
          "{{Dua}}",
          escapeHtml(values.Dua)
        );


      html =
        replaceAll(
          html,
          "{{Tiga}}",
          escapeHtml(values.Tiga)
        );


      html =
        replaceAll(
          html,
          "{{Empat}}",
          escapeHtml(values.Empat)
        );


      html =
        replaceAll(
          html,
          "{{Lima}}",
          escapeHtml(values.Lima)
        );


      html =
        replaceAll(
          html,
          "{{Enam}}",
          escapeHtml(values.Enam)
        );


      html =
        replaceAll(
          html,
          "{{Tujuh}}",
          escapeHtml(values.Tujuh)
        );


      html =
        replaceAll(
          html,
          "{{Delapan}}",
          escapeHtml(values.Delapan)
        );


      html =
        replaceAll(
          html,
          "{{Sembilan}}",
          escapeHtml(values.Sembilan)
        );


      html =
        replaceAll(
          html,
          "{{Sepuluh}}",
          escapeHtml(values.Sepuluh)
        );


      html =
        replaceAll(
          html,
          "{{Sebelas}}",
          escapeHtml(values.Sebelas)
        );


      html =
        replaceAll(
          html,
          "{{Duabelas}}",
          escapeHtml(values.Duabelas)
        );


      // =======================================================
      // TTD
      // =======================================================

      if (ttdBase64) {

        html =
          insertImage(
            html,
            "TTD",
            ttdBase64
          );

      }


      // =======================================================
      // STEMPEL
      // =======================================================

      if (stempelBase64) {

        html =
          insertImage(
            html,
            "STEMPEL",
            stempelBase64
          );

      }


      // =======================================================
      // LAUNCH BROWSER
      // =======================================================

      if (!env.BROWSER) {

        throw new Error(
          "Binding BROWSER belum tersedia."
        );

      }


      const browser =
        await puppeteer.launch(
          env.BROWSER
        );


      try {

        const page =
          await browser.newPage();


        // =====================================================
        // A4
        // =====================================================

        await page.setViewport({
          width: 794,
          height: 1123,
          deviceScaleFactor: 1
        });


        // =====================================================
        // LOAD HTML
        // =====================================================

        await page.setContent(
          html,
          {
            waitUntil: "networkidle0"
          }
        );


        // =====================================================
        // PDF
        // =====================================================

        const pdfBytes =
          await page.pdf({

            format: "A4",

            printBackground: true,

            margin: {
              top: "0mm",
              right: "0mm",
              bottom: "0mm",
              left: "0mm"
            }

          });


        // =====================================================
        // OPTIONAL PDF LIB LOAD
        // Untuk memastikan hasil benar-benar PDF
        // =====================================================

        const pdfDoc =
          await PDFDocument.load(pdfBytes);


        const finalPdf =
          await pdfDoc.save();


        // =====================================================
        // RETURN
        // =====================================================

        return jsonResponse({

          success: true,

          template:
            isPrekursor
              ? "Prekursor"
              : "Reguler",

          templateUrl,

          pageCount:
            pdfDoc.getPageCount(),

          prekursorLookup:
            prekursorLookup.length,

          pdfBase64:
            uint8ArrayToBase64(
              finalPdf
            )

        });

      } finally {

        await browser.close();

      }


    } catch (error) {

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
// CLEAN VALUE
// =============================================================

function cleanValue(value) {

  if (
    value === null ||
    value === undefined
  ) {

    return "";

  }

  return String(value);

}


// =============================================================
// REPLACE ALL
// =============================================================

function replaceAll(
  text,
  search,
  replacement
) {

  return text.split(search).join(
    replacement
  );

}


// =============================================================
// HTML ESCAPE
// =============================================================

function escapeHtml(value) {

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

}


// =============================================================
// INSERT IMAGE
// =============================================================

function insertImage(
  html,
  name,
  base64
) {

  const image =
    normalizeImageBase64(
      base64
    );


  // -----------------------------------------------------------
  // Placeholder {{TTD}}
  // -----------------------------------------------------------

  html =
    replaceAll(
      html,
      `{{${name}}}`,
      image
    );


  // -----------------------------------------------------------
  // Placeholder {{TTD_IMAGE}}
  // -----------------------------------------------------------

  html =
    replaceAll(
      html,
      `{{${name}_IMAGE}}`,
      image
    );


  return html;

}


// =============================================================
// NORMALIZE IMAGE
// =============================================================

function normalizeImageBase64(
  base64
) {

  const value =
    String(base64);


  if (
    value.startsWith(
      "data:image/"
    )
  ) {

    return value;

  }


  // PNG

  if (
    value.startsWith(
      "iVBORw0KGgo"
    )
  ) {

    return (
      "data:image/png;base64," +
      value
    );

  }


  // JPEG

  if (
    value.startsWith(
      "/9j/"
    )
  ) {

    return (
      "data:image/jpeg;base64," +
      value
    );

  }


  return value;

}


// =============================================================
// PREKURSOR CSV
// =============================================================

function parseCSV(csv) {

  const lines =
    csv
      .split(/\r?\n/)
      .filter(
        line =>
          line.trim() !== ""
      );


  if (
    lines.length < 2
  ) {

    return [];

  }


  const headers =
    parseCSVLine(
      lines[0]
    );


  const rows = [];


  for (
    let i = 1;
    i < lines.length;
    i++
  ) {

    const columns =
      parseCSVLine(
        lines[i]
      );


    const row = {};


    headers.forEach(
      (header, index) => {

        row[header] =
          columns[index] ??
          "";

      }
    );


    rows.push(row);

  }


  return rows;

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


    if (
      char === '"'
    ) {

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

    } else if (
      char === "," &&
      !insideQuotes
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


// =============================================================
// PRODUCT LOOKUP
// =============================================================

function findProduct(
  rows,
  searchValue
) {

  const search =
    normalizeSearch(
      searchValue
    );


  if (!search) {
    return null;
  }


  const possibleFields = [

    "Product SKU",

    "SKU",

    "product_sku",

    "PRODUCT SKU",

    "Kode",

    "Code"

  ];


  for (
    const row of rows
  ) {

    for (
      const field
      of possibleFields
    ) {

      if (
        row[field] ===
        undefined
      ) {

        continue;

      }


      if (
        normalizeSearch(
          row[field]
        ) === search
      ) {

        return row;

      }

    }

  }


  return null;

}


// =============================================================
// NORMALIZE SEARCH
// =============================================================

function normalizeSearch(
  value
) {

  return String(
    value ?? ""
  )
    .trim()
    .toLowerCase();

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


  return btoa(
    binary
  );

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
