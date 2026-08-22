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
  async fetch(request, env) {

    // =========================================================
    // GET - HEALTH CHECK
    // =========================================================

    if (request.method === "GET") {
      return jsonResponse({
        success: true,
        message: "SP GUARDIAN WORKER OK",
        worker: "suratpesanan-guardian",
        version: "HTML-TEMPLATE-FINAL"
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
      // GET PARAMETERS
      // =======================================================

      const template =
        body.template;

      const ttdBase64 =
        body.ttdBase64;

      const stempelBase64 =
        body.stempelBase64;

      const values = {
        Satu: safeValue(body.Satu),
        Dua: safeValue(body.Dua),
        Tiga: safeValue(body.Tiga),
        Empat: safeValue(body.Empat),
        Lima: safeValue(body.Lima),
        Enam: safeValue(body.Enam),
        Tujuh: safeValue(body.Tujuh),
        Delapan: safeValue(body.Delapan),
        Sembilan: safeValue(body.Sembilan),
        Sepuluh: safeValue(body.Sepuluh),
        Sebelas: safeValue(body.Sebelas),
        Duabelas: safeValue(body.Duabelas)
      };

      // =======================================================
      // SELECT TEMPLATE
      // =======================================================

      const templateName =
        String(template || "Reguler")
          .trim()
          .toLowerCase();

      const isPrekursor =
        templateName === "prekursor";

      const selectedTemplate =
        isPrekursor
          ? "Prekursor"
          : "Reguler";

      const templateURL =
        isPrekursor
          ? PREKURSOR_TEMPLATE_URL
          : REGULER_TEMPLATE_URL;

      // =======================================================
      // LOAD HTML FROM GITHUB
      // =======================================================

      const templateResponse =
        await fetch(templateURL);

      if (!templateResponse.ok) {
        throw new Error(
          "Gagal mengambil template " +
          selectedTemplate +
          ".html dari GitHub. HTTP " +
          templateResponse.status
        );
      }

      let html =
        await templateResponse.text();

      // =======================================================
      // REPLACE DATA
      // =======================================================

      html =
        replaceTemplateValues(
          html,
          values
        );

      // =======================================================
      // PREKURSOR MASTER LOOKUP
      // =======================================================

      let prekursorData = [];

      if (isPrekursor) {

        const csvResponse =
          await fetch(
            MASTER_PREKURSOR_URL
          );

        if (!csvResponse.ok) {
          throw new Error(
            "Gagal mengambil master_prekursor.csv. HTTP " +
            csvResponse.status
          );
        }

        const csvText =
          await csvResponse.text();

        prekursorData =
          parsePrekursorCSV(
            csvText
          );

        // -----------------------------------------------------
        // Masukkan master data ke HTML sebagai variable JS
        // -----------------------------------------------------

        html =
          injectPrekursorData(
            html,
            prekursorData
          );
      }

      // =======================================================
      // TTD + STEMPEL
      // =======================================================

      html =
        injectSignatureAndStamp(
          html,
          ttdBase64,
          stempelBase64
        );

      // =======================================================
      // CHECK BROWSER BINDING
      // =======================================================

      if (!env.BROWSER) {
        throw new Error(
          "Cloudflare Browser binding BROWSER tidak ditemukan."
        );
      }

      // =======================================================
      // LAUNCH BROWSER
      // =======================================================

      const browser =
        await puppeteer.launch(
          env.BROWSER
        );

      try {

        const page =
          await browser.newPage();

        // =====================================================
        // VIEWPORT
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
        // PRINT A4
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
        // RESPONSE
        // =====================================================

        return jsonResponse({
          success: true,

          worker:
            "suratpesanan-guardian",

          template:
            selectedTemplate,

          templateURL:
            templateURL,

          prekursorLookup:
            isPrekursor
              ? prekursorData.length
              : 0,

          pdfBase64:
            uint8ArrayToBase64(
              pdfBytes
            )
        });

      } finally {

        await browser.close();

      }

    } catch (error) {

      return jsonResponse(
        {
          success: false,

          error:
            error?.message ||
            String(error),

          stack:
            error?.stack ||
            null
        },
        500
      );
    }
  }
};


// =============================================================
// SAFE VALUE
// =============================================================

function safeValue(value) {

  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value);
}


// =============================================================
// REPLACE TEMPLATE VALUES
// =============================================================

function replaceTemplateValues(
  html,
  values
) {

  let result =
    String(html);

  for (
    const [key, value]
    of Object.entries(values)
  ) {

    // =========================================================
    // {{Satu}}
    // =========================================================

    result =
      result.replace(
        new RegExp(
          "\\{\\{\\s*" +
          escapeRegExp(key) +
          "\\s*\\}\\}",
          "gi"
        ),
        escapeHtml(value)
      );

    // =========================================================
    // [[Satu]]
    // =========================================================

    result =
      result.replace(
        new RegExp(
          "\\[\\[\\s*" +
          escapeRegExp(key) +
          "\\s*\\]\\]",
          "gi"
        ),
        escapeHtml(value)
      );

    // =========================================================
    // ${Satu}
    // =========================================================

    result =
      result.replace(
        new RegExp(
          "\\$\\{\\s*" +
          escapeRegExp(key) +
          "\\s*\\}",
          "gi"
        ),
        escapeHtml(value)
      );
  }

  return result;
}


// =============================================================
// PREKURSOR DATA
// =============================================================

function injectPrekursorData(
  html,
  data
) {

  const safeJSON =
    JSON.stringify(data)
      .replace(
        /</g,
        "\\u003c"
      )
      .replace(
        />/g,
        "\\u003e"
      )
      .replace(
        /&/g,
        "\\u0026"
      );

  const script = `
<script>
window.PREKURSOR_DATA = ${safeJSON};
</script>
`;

  if (
    html.includes("</head>")
  ) {

    return html.replace(
      "</head>",
      script + "</head>"
    );
  }

  return script + html;
}


// =============================================================
// TTD + STEMPEL
// =============================================================

function injectSignatureAndStamp(
  html,
  ttdBase64,
  stempelBase64
) {

  if (
    !ttdBase64 &&
    !stempelBase64
  ) {
    return html;
  }

  const ttd =
    normalizeImageBase64(
      ttdBase64
    );

  const stempel =
    normalizeImageBase64(
      stempelBase64
    );

  let block = `
<div
  id="sp-signature-block"
  style="
    position:absolute;
    right:30mm;
    bottom:20mm;
    width:70mm;
    height:40mm;
    z-index:99999;
    pointer-events:none;
  "
>
`;

  // ===========================================================
  // STEMPEL
  // ===========================================================

  if (stempel) {

    block += `
<img
  src="${stempel}"
  style="
    position:absolute;
    left:0;
    bottom:0;
    width:32mm;
    height:32mm;
    object-fit:contain;
  "
>
`;
  }

  // ===========================================================
  // TTD
  // ===========================================================

  if (ttd) {

    block += `
<img
  src="${ttd}"
  style="
    position:absolute;
    left:16mm;
    bottom:8mm;
    width:45mm;
    height:23mm;
    object-fit:contain;
  "
>
`;
  }

  block += `
</div>
`;

  // ===========================================================
  // INSERT INTO BODY
  // ===========================================================

  if (
    html.includes("</body>")
  ) {

    return html.replace(
      "</body>",
      block + "</body>"
    );
  }

  return html + block;
}


// =============================================================
// IMAGE BASE64
// =============================================================

function normalizeImageBase64(
  value
) {

  if (!value) {
    return "";
  }

  let clean =
    String(value).trim();

  // ===========================================================
  // Already data URI
  // ===========================================================

  if (
    clean.startsWith(
      "data:image/"
    )
  ) {
    return clean;
  }

  // ===========================================================
  // Remove possible prefix
  // ===========================================================

  clean =
    clean.replace(
      /^data:image\/[^;]+;base64,/i,
      ""
    );

  try {

    const bytes =
      base64ToUint8Array(
        clean
      );

    // =========================================================
    // PNG
    // =========================================================

    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    ) {

      return (
        "data:image/png;base64," +
        clean
      );
    }

    // =========================================================
    // JPEG
    // =========================================================

    if (
      bytes[0] === 0xff &&
      bytes[1] === 0xd8
    ) {

      return (
        "data:image/jpeg;base64," +
        clean
      );
    }

  } catch {

    return "";
  }

  return "";
}


// =============================================================
// PREKURSOR CSV
// =============================================================

function parsePrekursorCSV(
  csv
) {

  const lines =
    String(csv)
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

        row[header] =
          columns[index] ??
          "";
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
// BASE64 -> UINT8ARRAY
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
// UINT8ARRAY -> BASE64
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
// JSON RESPONSE
// =============================================================

function jsonResponse(
  data,
  status = 200
) {

  return new Response(
    JSON.stringify(data),
    {
      status: status,

      headers: {
        "Content-Type":
          "application/json; charset=UTF-8"
      }
    }
  );
}
