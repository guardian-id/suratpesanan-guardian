import puppeteer from "@cloudflare/puppeteer";

const GITHUB_RAW_BASE =
  "https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main";

const REGULER_TEMPLATE_URL =
  GITHUB_RAW_BASE + "/Reguler.html";

const PREKURSOR_TEMPLATE_URL =
  GITHUB_RAW_BASE + "/Prekursor.html";

const MASTER_PREKURSOR_URL =
  GITHUB_RAW_BASE + "/master_prekursor.csv";


export default {
  async fetch(request, env, ctx) {

    // =====================================================
    // GET - HEALTH CHECK
    // =====================================================

    if (request.method === "GET") {
      return jsonResponse({
        success: true,
        message: "SP GUARDIAN WORKER OK",
        worker: "suratpesanan-guardian",
        version: "FINAL-HTML-1"
      });
    }


    // =====================================================
    // ONLY POST
    // =====================================================

    if (request.method !== "POST") {
      return jsonResponse({
        success: false,
        error: "Method not allowed"
      }, 405);
    }


    try {

      // ===================================================
      // READ JSON
      // ===================================================

      const body = await request.json();

      if (!body || typeof body !== "object") {
        return jsonResponse({
          success: false,
          error: "Invalid request body"
        }, 400);
      }


      // ===================================================
      // TEMPLATE
      // ===================================================

      const template =
        String(body.template || "Reguler")
          .trim()
          .toLowerCase();


      let templateUrl = REGULER_TEMPLATE_URL;
      let templateName = "Reguler";


      if (template === "prekursor") {
        templateUrl = PREKURSOR_TEMPLATE_URL;
        templateName = "Prekursor";
      }


      // ===================================================
      // DATA
      // ===================================================

      const values = {

        Satu: body.Satu ?? "",
        Dua: body.Dua ?? "",
        Tiga: body.Tiga ?? "",
        Empat: body.Empat ?? "",
        Lima: body.Lima ?? "",
        Enam: body.Enam ?? "",
        Tujuh: body.Tujuh ?? "",
        Delapan: body.Delapan ?? "",
        Sembilan: body.Sembilan ?? "",
        Sepuluh: body.Sepuluh ?? "",
        Sebelas: body.Sebelas ?? "",
        Duabelas: body.Duabelas ?? ""

      };


      // ===================================================
      // LOAD HTML TEMPLATE
      // ===================================================

      const templateResponse =
        await fetch(templateUrl);


      if (!templateResponse.ok) {

        throw new Error(
          "Template " +
          templateName +
          ".html tidak ditemukan di GitHub. HTTP " +
          templateResponse.status
        );

      }


      let html =
        await templateResponse.text();


      // ===================================================
      // REPLACE Satu - Duabelas
      // ===================================================

      html =
        replaceTemplateValues(
          html,
          values
        );


      // ===================================================
      // TTD
      // ===================================================

      if (body.ttdBase64) {

        html =
          injectImage(
            html,
            "TTD",
            body.ttdBase64
          );

      }


      // ===================================================
      // STEMPEL
      // ===================================================

      if (body.stempelBase64) {

        html =
          injectImage(
            html,
            "STEMPEL",
            body.stempelBase64
          );

      }


      // ===================================================
      // PREKURSOR
      // =====================================================

      let prekursorCount = 0;


      if (templateName === "Prekursor") {

        const rows =
          await loadPrekursorMaster();


        prekursorCount =
          rows.length;


        html =
          injectPrekursorData(
            html,
            rows
          );

      }


      // ===================================================
      // A4 PRINT CSS
      // ===================================================

      html =
        addA4PrintCSS(html);


      // ===================================================
      // BROWSER CHECK
      // ===================================================

      if (!env.BROWSER) {

        throw new Error(
          "BROWSER binding tidak tersedia di Cloudflare."
        );

      }


      // ===================================================
      // LAUNCH BROWSER
      // ===================================================

      const browser =
        await puppeteer.launch(
          env.BROWSER
        );


      try {

        const page =
          await browser.newPage();


        // A4 viewport

        await page.setViewport({
          width: 794,
          height: 1123,
          deviceScaleFactor: 1
        });


        // =================================================
        // LOAD HTML
        // =================================================

        await page.setContent(
          html,
          {
            waitUntil: "networkidle0"
          }
        );


        // =================================================
        // GENERATE PDF A4
        // =================================================

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


        // =================================================
        // RESPONSE
        // =================================================

        return jsonResponse({

          success: true,

          template: templateName,

          prekursorLookup:
            prekursorCount,

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
          error?.message ||
          String(error)

      }, 500);

    }

  }
};


// =========================================================
// REPLACE TEMPLATE VALUES
// =========================================================

function replaceTemplateValues(
  html,
  values
) {

  let result = html;


  for (
    const [key, value]
    of Object.entries(values)
  ) {

    const safeValue =
      escapeHtml(
        String(value ?? "")
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
        safeValue
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
        safeValue
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
        safeValue
      );

  }


  return result;
}


// =========================================================
// IMAGE INJECTION
// =========================================================

function injectImage(
  html,
  placeholder,
  base64
) {

  if (!base64) {
    return html;
  }


  const imageSrc =
    normalizeImageBase64(base64);


  const imageHtml =
    '<img src="' +
    imageSrc +
    '" class="sp-' +
    placeholder.toLowerCase() +
    '" />';


  return html

    .replace(
      new RegExp(
        "\\{\\{\\s*" +
        placeholder +
        "\\s*\\}\\}",
        "gi"
      ),
      imageHtml
    )

    .replace(
      new RegExp(
        "\\[\\[\\s*" +
        placeholder +
        "\\s*\\]\\]",
        "gi"
      ),
      imageHtml
    );

}


// =========================================================
// NORMALIZE IMAGE
// =========================================================

function normalizeImageBase64(
  base64
) {

  const value =
    String(base64).trim();


  if (
    /^data:image\//i.test(value)
  ) {

    return value;

  }


  if (
    value.startsWith("iVBOR")
  ) {

    return (
      "data:image/png;base64," +
      value
    );

  }


  if (
    value.startsWith("/9j/")
  ) {

    return (
      "data:image/jpeg;base64," +
      value
    );

  }


  return (
    "data:image/png;base64," +
    value
  );

}


// =========================================================
// PREKURSOR MASTER
// =========================================================

async function loadPrekursorMaster() {

  const response =
    await fetch(
      MASTER_PREKURSOR_URL
    );


  if (!response.ok) {

    throw new Error(
      "Gagal mengambil master_prekursor.csv. HTTP " +
      response.status
    );

  }


  const csv =
    await response.text();


  return parseCSV(csv);

}


// =========================================================
// CSV PARSER
// =========================================================

function parseCSV(csv) {

  const lines =
    csv
      .split(/\r?\n/)
      .filter(
        line =>
          line.trim() !== ""
      );


  if (lines.length < 2) {
    return [];
  }


  const headers =
    parseCSVLine(lines[0]);


  const result = [];


  for (
    let i = 1;
    i < lines.length;
    i++
  ) {

    const columns =
      parseCSVLine(lines[i]);


    const row = {};


    headers.forEach(
      (header, index) => {

        row[
          header.trim()
        ] =
          columns[index] ?? "";

      }
    );


    result.push(row);

  }


  return result;

}


// =========================================================
// CSV LINE
// =========================================================

function parseCSVLine(line) {

  const result = [];

  let current = "";

  let insideQuotes = false;


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


// =========================================================
// PREKURSOR HTML
// =========================================================

function injectPrekursorData(
  html,
  rows
) {

  html =
    html.replace(
      /\{\{\s*PREKURSOR_COUNT\s*\}\}/gi,
      String(rows.length)
    );


  return html;

}


// =========================================================
// A4 CSS
// =========================================================

function addA4PrintCSS(
  html
) {

  const css =
    "<style>" +

    "@page {" +
    "size: A4;" +
    "margin: 0;" +
    "}" +

    "html, body {" +
    "margin: 0;" +
    "padding: 0;" +
    "width: 210mm;" +
    "min-height: 297mm;" +
    "}" +

    "* {" +
    "box-sizing: border-box;" +
    "}" +

    ".sp-ttd {" +
    "max-width: 170px;" +
    "max-height: 90px;" +
    "object-fit: contain;" +
    "}" +

    ".sp-stempel {" +
    "max-width: 120px;" +
    "max-height: 120px;" +
    "object-fit: contain;" +
    "}" +

    "@media print {" +

    "html, body {" +
    "width: 210mm;" +
    "margin: 0;" +
    "padding: 0;" +
    "}" +

    "}" +

    "</style>";


  if (
    html.includes("</head>")
  ) {

    return html.replace(
      "</head>",
      css + "</head>"
    );

  }


  return css + html;

}


// =========================================================
// ESCAPE HTML
// =========================================================

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


// =========================================================
// ESCAPE REGEX
// =========================================================

function escapeRegExp(
  value
) {

  return String(value)
    .replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

}


// =========================================================
// UINT8ARRAY -> BASE64
// =========================================================

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


// =========================================================
// JSON RESPONSE
// =========================================================

function jsonResponse(
  data,
  status = 200
) {

  return new Response(
    JSON.stringify(data),
    {
      status: status,

      headers: {
        "content-type":
          "application/json; charset=UTF-8"
      }
    }
  );

}
