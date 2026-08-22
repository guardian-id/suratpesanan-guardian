```javascript
import puppeteer from "@cloudflare/puppeteer";


// ============================================================
// GITHUB FILES
// ============================================================

const REGULER_HTML_URL =
  "https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main/Reguler.html";

const PREKURSOR_HTML_URL =
  "https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main/Prekursor.html";

const MASTER_PREKURSOR_URL =
  "https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main/master_prekursor.csv";


// ============================================================
// WORKER
// ============================================================

export default {

  async fetch(request, env, ctx) {

    // ========================================================
    // GET - HEALTH CHECK
    // ========================================================

    if (request.method === "GET") {

      return jsonResponse({
        success: true,
        message: "SP GUARDIAN WORKER OK",
        worker: "suratpesanan-guardian",
        version: "FINAL-HTML-2026-08-22"
      });

    }


    // ========================================================
    // ONLY POST
    // ========================================================

    if (request.method !== "POST") {

      return jsonResponse({
        success: false,
        error: "Method not allowed"
      }, 405);

    }


    try {

      // ======================================================
      // READ JSON
      // ======================================================

      const body = await request.json();


      if (!body || typeof body !== "object") {

        return jsonResponse({
          success: false,
          error: "Invalid JSON body"
        }, 400);

      }


      // ======================================================
      // TEMPLATE
      // ======================================================

      const template =
        String(body.template || "Reguler")
          .trim()
          .toLowerCase();


      let templateName = "Reguler";

      let templateUrl = REGULER_HTML_URL;


      if (template === "prekursor") {

        templateName = "Prekursor";

        templateUrl = PREKURSOR_HTML_URL;

      }


      // ======================================================
      // DATA Satu - Duabelas
      // ======================================================

      const values = {

        Satu: safeString(body.Satu),

        Dua: safeString(body.Dua),

        Tiga: safeString(body.Tiga),

        Empat: safeString(body.Empat),

        Lima: safeString(body.Lima),

        Enam: safeString(body.Enam),

        Tujuh: safeString(body.Tujuh),

        Delapan: safeString(body.Delapan),

        Sembilan: safeString(body.Sembilan),

        Sepuluh: safeString(body.Sepuluh),

        Sebelas: safeString(body.Sebelas),

        Duabelas: safeString(body.Duabelas)

      };


      // ======================================================
      // DOWNLOAD HTML TEMPLATE
      // ======================================================

      const templateResponse =
        await fetch(templateUrl);


      if (!templateResponse.ok) {

        throw new Error(
          "Template " +
          templateName +
          ".html tidak dapat diambil dari GitHub. HTTP " +
          templateResponse.status
        );

      }


      let html =
        await templateResponse.text();


      if (!html || html.trim() === "") {

        throw new Error(
          "Template " +
          templateName +
          ".html kosong."
        );

      }


      // ======================================================
      // PREKURSOR MASTER
      // ======================================================

      let prekursorRows = [];


      if (templateName === "Prekursor") {

        prekursorRows =
          await loadPrekursorMaster();

      }


      // ======================================================
      // REPLACE DATA
      // ======================================================

      html =
        replaceAllPlaceholders(
          html,
          values
        );


      // ======================================================
      // PREKURSOR DATA
      // ======================================================

      if (templateName === "Prekursor") {

        html =
          applyPrekursorLookup(
            html,
            prekursorRows,
            body
          );

      }


      // ======================================================
      // TTD + STEMPEL
      // ======================================================

      html =
        applySignatureAndStamp(
          html,
          body.ttdBase64,
          body.stempelBase64
        );


      // ======================================================
      // A4 CSS
      // ======================================================

      html =
        injectA4CSS(html);


      // ======================================================
      // BROWSER BINDING
      // ======================================================

      if (!env.BROWSER) {

        throw new Error(
          "Cloudflare Browser binding BROWSER tidak tersedia."
        );

      }


      // ======================================================
      // LAUNCH BROWSER
      // ======================================================

      const browser =
        await puppeteer.launch(
          env.BROWSER
        );


      try {

        // ====================================================
        // NEW PAGE
        // ====================================================

        const page =
          await browser.newPage();


        // ====================================================
        // VIEWPORT A4
        // ====================================================

        await page.setViewport({

          width: 794,

          height: 1123,

          deviceScaleFactor: 1

        });


        // ====================================================
        // LOAD HTML
        // ====================================================

        await page.setContent(
          html,
          {
            waitUntil: "networkidle0"
          }
        );


        // ====================================================
        // WAIT IMAGE
        // ====================================================

        await page.evaluate(async function () {

          const images =
            Array.from(
              document.images
            );

          await Promise.all(
            images.map(
              function (img) {

                if (img.complete) {
                  return Promise.resolve();
                }

                return new Promise(
                  function (resolve) {

                    img.onload = resolve;

                    img.onerror = resolve;

                  }
                );

              }
            )
          );

        });


        // ====================================================
        // PDF A4
        // ====================================================

        const pdfBytes =
          await page.pdf({

            format: "A4",

            printBackground: true,

            preferCSSPageSize: true,

            margin: {

              top: "0mm",

              right: "0mm",

              bottom: "0mm",

              left: "0mm"

            }

          });


        // ====================================================
        // RETURN
        // ====================================================

        return jsonResponse({

          success: true,

          template: templateName,

          pageCount:
            await page.evaluate(
              function () {

                return Math.ceil(
                  document.body.scrollHeight /
                  document.documentElement.clientHeight
                );

              }
            ),

          prekursorLookup:
            prekursorRows.length,

          pdfBase64:
            uint8ArrayToBase64(
              new Uint8Array(pdfBytes)
            )

        });


      } finally {

        await browser.close();

      }


    } catch (error) {

      return jsonResponse({

        success: false,

        error:
          error &&
          error.message
            ? error.message
            : String(error)

      }, 500);

    }

  }

};


// ============================================================
// REPLACE ALL PLACEHOLDERS
// ============================================================

function replaceAllPlaceholders(
  html,
  values
) {

  let result = html;


  for (
    const key of Object.keys(values)
  ) {

    const value =
      escapeHtml(
        values[key]
      );


    // {{Satu}}

    result =
      result.replace(
        new RegExp(
          "\\{\\{\\s*" +
          escapeRegExp(key) +
          "\\s*\\}\\}",
          "gi"
        ),
        value
      );


    // [[Satu]]

    result =
      result.replace(
        new RegExp(
          "\\[\\[\\s*" +
          escapeRegExp(key) +
          "\\s*\\]\\]",
          "gi"
        ),
        value
      );


    // <<Satu>>

    result =
      result.replace(
        new RegExp(
          "<<\\s*" +
          escapeRegExp(key) +
          "\\s*>>",
          "gi"
        ),
        value
      );


    // {{ Satu }}

    result =
      result.replace(
        new RegExp(
          "\\{\\{\\s*" +
          escapeRegExp(key) +
          "\\s*\\}\\}",
          "gi"
        ),
        value
      );

  }


  return result;

}


// ============================================================
// PREKURSOR LOOKUP
// ============================================================

function applyPrekursorLookup(
  html,
  rows,
  body
) {

  // ----------------------------------------------------------
  // Jumlah master
  // ----------------------------------------------------------

  html =
    replacePlaceholder(
      html,
      "PREKURSOR_COUNT",
      String(rows.length)
    );


  // ----------------------------------------------------------
  // Jika Power Automate mengirim SKU
  // ----------------------------------------------------------

  const sku =
    safeString(
      body.productSKU ||
      body.SKU ||
      body.sku
    );


  if (!sku) {

    return html;

  }


  // ----------------------------------------------------------
  // Cari SKU
  // ----------------------------------------------------------

  const found =
    rows.find(
      function (row) {

        const rowSku =
          safeString(
            row["Product SKU"] ||
            row["SKU"] ||
            row["sku"]
          );

        return (
          rowSku.toLowerCase() ===
          sku.toLowerCase()
        );

      }
    );


  if (!found) {

    return html;

  }


  // ----------------------------------------------------------
  // Zat Aktif
  // ----------------------------------------------------------

  const zatAktif =
    safeString(
      found["Zat Aktif"] ||
      found["ZatAktif"] ||
      found["ZAT AKTIF"]
    );


  // ----------------------------------------------------------
  // Bentuk
  // ----------------------------------------------------------

  const bentuk =
    safeString(
      found["Bentuk"] ||
      found["BENTUK"]
    );


  html =
    replacePlaceholder(
      html,
      "ZAT_AKTIF",
      zatAktif
    );


  html =
    replacePlaceholder(
      html,
      "ZatAktif",
      zatAktif
    );


  html =
    replacePlaceholder(
      html,
      "BENTUK",
      bentuk
    );


  html =
    replacePlaceholder(
      html,
      "Bentuk",
      bentuk
    );


  return html;

}


// ============================================================
// SIGNATURE + STAMP
// ============================================================

function applySignatureAndStamp(
  html,
  ttdBase64,
  stempelBase64
) {

  let result = html;


  // ==========================================================
  // TTD
  // ==========================================================

  if (ttdBase64) {

    const ttd =
      normalizeImageBase64(
        ttdBase64
      );


    const ttdHtml =
      '<img class="sp-ttd" src="' +
      ttd +
      '" />';


    result =
      replacePlaceholder(
        result,
        "TTD",
        ttdHtml
      );

  }


  // ==========================================================
  // STEMPEL
  // ==========================================================

  if (stempelBase64) {

    const stempel =
      normalizeImageBase64(
        stempelBase64
      );


    const stempelHtml =
      '<img class="sp-stempel" src="' +
      stempel +
      '" />';


    result =
      replacePlaceholder(
        result,
        "STEMPEL",
        stempelHtml
      );

  }


  return result;

}


// ============================================================
// REPLACE SINGLE PLACEHOLDER
// ============================================================

function replacePlaceholder(
  html,
  name,
  value
) {

  let result = html;


  result =
    result.replace(
      new RegExp(
        "\\{\\{\\s*" +
        escapeRegExp(name) +
        "\\s*\\}\\}",
        "gi"
      ),
      value
    );


  result =
    result.replace(
      new RegExp(
        "\\[\\[\\s*" +
        escapeRegExp(name) +
        "\\s*\\]\\]",
        "gi"
      ),
      value
    );


  result =
    result.replace(
      new RegExp(
        "<<\\s*" +
        escapeRegExp(name) +
        "\\s*>>",
        "gi"
      ),
      value
    );


  return result;

}


// ============================================================
// IMAGE NORMALIZER
// ============================================================

function normalizeImageBase64(
  value
) {

  const clean =
    String(value)
      .trim();


  if (
    /^data:image\//i.test(clean)
  ) {

    return clean;

  }


  if (
    clean.indexOf("iVBOR") === 0
  ) {

    return (
      "data:image/png;base64," +
      clean
    );

  }


  if (
    clean.indexOf("/9j/") === 0
  ) {

    return (
      "data:image/jpeg;base64," +
      clean
    );

  }


  return (
    "data:image/png;base64," +
    clean
  );

}


// ============================================================
// LOAD MASTER PREKURSOR
// ============================================================

async function loadPrekursorMaster() {

  const response =
    await fetch(
      MASTER_PREKURSOR_URL
    );


  if (!response.ok) {

    throw new Error(
      "Gagal membaca master_prekursor.csv. HTTP " +
      response.status
    );

  }


  const csv =
    await response.text();


  return parseCSV(csv);

}


// ============================================================
// CSV PARSER
// ============================================================

function parseCSV(
  csv
) {

  const lines =
    csv
      .split(/\r?\n/)
      .filter(
        function (line) {

          return line.trim() !== "";

        }
      );


  if (lines.length < 2) {

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
      function (header, index) {

        row[
          header.trim()
        ] =
          columns[index] || "";

      }
    );


    rows.push(row);

  }


  return rows;

}


// ============================================================
// CSV LINE PARSER
// ============================================================

function parseCSVLine(
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

        quoted = !quoted;

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


// ============================================================
// A4 CSS
// ============================================================

function injectA4CSS(
  html
) {

  const css =
    "<style>" +

    "@page{" +
    "size:A4;" +
    "margin:0;" +
    "}" +

    "html,body{" +
    "width:210mm;" +
    "min-height:297mm;" +
    "margin:0;" +
    "padding:0;" +
    "}" +

    "body{" +
    "-webkit-print-color-adjust:exact;" +
    "print-color-adjust:exact;" +
    "}" +

    "*{" +
    "box-sizing:border-box;" +
    "}" +

    ".sp-ttd{" +
    "max-width:170px;" +
    "max-height:90px;" +
    "object-fit:contain;" +
    "display:inline-block;" +
    "}" +

    ".sp-stempel{" +
    "max-width:120px;" +
    "max-height:120px;" +
    "object-fit:contain;" +
    "display:inline-block;" +
    "}" +

    "</style>";


  if (
    html.indexOf("</head>") !== -1
  ) {

    return html.replace(
      "</head>",
      css + "</head>"
    );

  }


  return css + html;

}


// ============================================================
// SAFE STRING
// ============================================================

function safeString(
  value
) {

  if (
    value === null ||
    value === undefined
  ) {

    return "";

  }


  return String(value);

}


// ============================================================
// HTML ESCAPE
// ============================================================

function escapeHtml(
  value
) {

  return String(value)

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
// REGEX ESCAPE
// ============================================================

function escapeRegExp(
  value
) {

  return String(value)
    .replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

}


// ============================================================
// UINT8 ARRAY -> BASE64
// ============================================================

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

    const chunk =
      bytes.subarray(
        i,
        Math.min(
          i + chunkSize,
          bytes.length
        )
      );


    binary +=
      String.fromCharCode(
        ...chunk
      );

  }


  return btoa(binary);

}


// ============================================================
// JSON RESPONSE
// ============================================================

function jsonResponse(
  data,
  status
) {

  return new Response(
    JSON.stringify(data),
    {
      status:
        status || 200,

      headers: {
        "content-type":
          "application/json; charset=UTF-8"
      }
    }
  );

}
```
