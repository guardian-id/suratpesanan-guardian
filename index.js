import puppeteer from "@cloudflare/puppeteer";

const GITHUB_RAW_BASE =
  "https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main";

const TEMPLATE_URLS = {
  reguler: `${GITHUB_RAW_BASE}/Reguler.html`,
  prekursor: `${GITHUB_RAW_BASE}/Prekursor.html`
};

const MASTER_PREKURSOR_URL =
  `${GITHUB_RAW_BASE}/master_prekursor.csv`;


export default {
  async fetch(request, env, ctx) {

    // =========================================================
    // GET - HEALTH CHECK
    // =========================================================

    if (request.method === "GET") {
      return jsonResponse({
        success: true,
        message: "SP GUARDIAN WORKER OK",
        worker: "suratpesanan-guardian",
        version: "FINAL-HTML-2TEMPLATE"
      });
    }


    // =========================================================
    // ONLY POST
    // =========================================================

    if (request.method !== "POST") {
      return jsonResponse(
        {
          success: false,
          error: "Method not allowed"
        },
        405
      );
    }


    try {

      // =======================================================
      // READ JSON
      // =======================================================

      const body = await request.json();


      if (!body || typeof body !== "object") {
        return jsonResponse(
          {
            success: false,
            error: "Invalid request body"
          },
          400
        );
      }


      // =======================================================
      // GET INPUT
      // =======================================================

      const template =
        String(body.template || "Reguler")
          .trim()
          .toLowerCase();


      const pdfBase64 =
        body.pdfBase64 || "";


      const ttdBase64 =
        body.ttdBase64 || "";


      const stempelBase64 =
        body.stempelBase64 || "";


      // =======================================================
      // DATA Satu - Duabelas
      // =======================================================

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


      // =======================================================
      // TEMPLATE
      // =======================================================

      let templateName;
      let templateUrl;

      if (template === "prekursor") {

        templateName = "Prekursor";
        templateUrl = TEMPLATE_URLS.prekursor;

      } else {

        templateName = "Reguler";
        templateUrl = TEMPLATE_URLS.reguler;

      }


      // =======================================================
      // GET HTML TEMPLATE
      // =======================================================

      const templateResponse =
        await fetch(templateUrl);


      if (!templateResponse.ok) {

        throw new Error(
          `Template ${templateName}.html tidak dapat diambil dari GitHub. HTTP ${templateResponse.status}`
        );

      }


      let html =
        await templateResponse.text();


      // =======================================================
      // PREKURSOR LOOKUP
      // =======================================================

      let prekursorLookup = [];

      if (templateName === "Prekursor") {

        prekursorLookup =
          await loadPrekursorMaster();

      }


      // =======================================================
      // INSERT DATA KE HTML
      // =======================================================

      html =
        replaceTemplateValues(
          html,
          values
        );


      // =======================================================
      // INSERT TTD
      // =======================================================

      html =
        injectImage(
          html,
          "TTD",
          ttdBase64
        );


      // =======================================================
      // INSERT STEMPEL
      // =======================================================

      html =
        injectImage(
          html,
          "STEMPEL",
          stempelBase64
        );


      // =======================================================
      // INSERT PREKURSOR MASTER
      // =======================================================

      if (templateName === "Prekursor") {

        html =
          injectPrekursorData(
            html,
            prekursorLookup
          );

      }


      // =======================================================
      // ADD A4 PRINT CSS
      // =======================================================

      html =
        addA4PrintCSS(html);


      // =======================================================
      // START CLOUDFLARE BROWSER
      // =======================================================

      if (!env.BROWSER) {

        throw new Error(
          "BROWSER binding tidak tersedia. Pastikan wrangler.json memiliki browser.binding = BROWSER."
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
        // SET VIEWPORT
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
        // PDF A4
        // =====================================================

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


        // =====================================================
        // RETURN BASE64
        // =====================================================

        const outputBase64 =
          uint8ArrayToBase64(
            new Uint8Array(pdfBytes)
          );


        return jsonResponse({

          success: true,

          template: templateName,

          pdfBase64: outputBase64,

          prekursorLookup:
            templateName === "Prekursor"
              ? prekursorLookup.length
              : 0

        });


      } finally {

        await browser.close();

      }


    } catch (error) {

      return jsonResponse(
        {
          success: false,
          error: error?.message || String(error),
          stack: error?.stack || null
        },
        500
      );

    }

  }
};


// =============================================================
// REPLACE TEMPLATE VALUES
// =============================================================

function replaceTemplateValues(
  html,
  values
) {

  let result = html;


  for (const [key, value] of Object.entries(values)) {

    const safeValue =
      escapeHtml(
        String(value ?? "")
      );


    // =========================================================
    // SUPPORT:
    //
    // {{Satu}}
    // {{ Satu }}
    // [[Satu]]
    // [[ Satu ]]
    // ${Satu}
    // =========================================================

    const patterns = [

      new RegExp(
        `\\{\\{\\s*${escapeRegExp(key)}\\s*\\}\\}`,
        "gi"
      ),

      new RegExp(
        `\\[\\[\\s*${escapeRegExp(key)}\\s*\\]\\]`,
        "gi"
      ),

      new RegExp(
        `\\$\\{\\s*${escapeRegExp(key)}\\s*\\}`,
        "gi"
      )

    ];


    for (const pattern of patterns) {

      result =
        result.replace(
          pattern,
          safeValue
        );

    }

  }


  return result;
}


// =============================================================
// INJECT TTD / STEMPEL
// =============================================================

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
    `<img src="${imageSrc}" class="sp-${placeholder.toLowerCase()}" />`;


  const patterns = [

    new RegExp(
      `\\{\\{\\s*${placeholder}\\s*\\}\\}`,
      "gi"
    ),

    new RegExp(
      `\\[\\[\\s*${placeholder}\\s*\\]\\]`,
      "gi"
    ),

    new RegExp(
      `\\$\\{\\s*${placeholder}\\s*\\}`,
      "gi"
    )

  ];


  let result = html;


  for (const pattern of patterns) {

    result =
      result.replace(
        pattern,
        imageHtml
      );

  }


  return result;
}


// =============================================================
// NORMALIZE IMAGE BASE64
// =============================================================

function normalizeImageBase64(
  base64
) {

  const value =
    String(base64).trim();


  // Already data URI
  if (
    /^data:image\//i.test(value)
  ) {

    return value;

  }


  // Try PNG
  if (
    value.startsWith("iVBOR")
  ) {

    return `data:image/png;base64,${value}`;

  }


  // Try JPEG
  if (
    value.startsWith("/9j/")
  ) {

    return `data:image/jpeg;base64,${value}`;

  }


  // Default PNG
  return `data:image/png;base64,${value}`;
}


// =============================================================
// PREKURSOR MASTER
// =============================================================

async function loadPrekursorMaster() {

  const response =
    await fetch(
      MASTER_PREKURSOR_URL
    );


  if (!response.ok) {

    throw new Error(
      `master_prekursor.csv gagal diambil. HTTP ${response.status}`
    );

  }


  const csv =
    await response.text();


  return parseCSV(csv);
}


// =============================================================
// CSV PARSER
// =============================================================

function parseCSV(csv) {

  const lines =
    csv
      .split(/\r?\n/)
      .filter(
        line => line.trim() !== ""
      );


  if (lines.length < 2) {
    return [];
  }


  const headers =
    parseCSVLine(
      lines[0]
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


// =============================================================
// CSV LINE
// =============================================================

function parseCSVLine(
  line
) {

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


// =============================================================
// INJECT PREKURSOR DATA
// =============================================================

function injectPrekursorData(
  html,
  rows
) {

  // ===========================================================
  // JSON DATA
  // ===========================================================

  const json =
    JSON.stringify(rows);


  // ===========================================================
  // SUPPORT PLACEHOLDER:
  //
  // {{PREKURSOR_DATA}}
  // ===========================================================

  html =
    html.replace(
      /\{\{\s*PREKURSOR_DATA\s*\}\}/gi,
      escapeHtml(json)
    );


  // ===========================================================
  // NUMBER OF RECORDS
  // ===========================================================

  html =
    html.replace(
      /\{\{\s*PREKURSOR_COUNT\s*\}\}/gi,
      String(rows.length)
    );


  return html;
}


// =============================================================
// ADD A4 CSS
// =============================================================

function addA4PrintCSS(
  html
) {

  const css = `
<style>

@page {
  size: A4;
  margin: 0;
}

html,
body {
  margin: 0;
  padding: 0;
  width: 210mm;
  min-height: 297mm;
}

* {
  box-sizing: border-box;
}

.sp-ttd {
  max-width: 170px;
  max-height: 90px;
  object-fit: contain;
}

.sp-stempel {
  max-width: 120px;
  max-height: 120px;
  object-fit: contain;
}

@media print {

  html,
  body {
    width: 210mm;
    margin: 0;
    padding: 0;
  }

}

</style>
`;


  return html.includes("</head>")
    ? html.replace(
        "</head>",
        `${css}</head>`
      )
    : `${css}${html}`;
}


// =============================================================
// HTML ESCAPE
// =============================================================

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


// =============================================================
// REGEX ESCAPE
// =============================================================

function escapeRegExp(
  value
) {

  return String(value)
    .replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );
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
    JSON.stringify(data),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=UTF-8"
      }
    }
  );
}
