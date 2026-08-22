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
        version: "FINAL-HTML-2-TEMPLATE"
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

      const {
        template,

        pdfBase64,
        ttdBase64,
        stempelBase64,

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
      // DATA
      // =======================================================

      const values = {
        Satu: safeValue(Satu),
        Dua: safeValue(Dua),
        Tiga: safeValue(Tiga),
        Empat: safeValue(Empat),
        Lima: safeValue(Lima),
        Enam: safeValue(Enam),
        Tujuh: safeValue(Tujuh),
        Delapan: safeValue(Delapan),
        Sembilan: safeValue(Sembilan),
        Sepuluh: safeValue(Sepuluh),
        Sebelas: safeValue(Sebelas),
        Duabelas: safeValue(Duabelas)
      };

      // =======================================================
      // LOAD HTML TEMPLATE
      // =======================================================

      const templateResponse =
        await fetch(templateURL);

      if (!templateResponse.ok) {
        throw new Error(
          `Template ${selectedTemplate}.html gagal diambil dari GitHub. HTTP ${templateResponse.status}`
        );
      }

      let html =
        await templateResponse.text();

      // =======================================================
      // REPLACE PLACEHOLDER
      // =======================================================

      html =
        replaceTemplateValues(
          html,
          values
        );

      // =======================================================
      // PREKURSOR LOOKUP
      // =======================================================

      let prekursorLookup = [];

      if (isPrekursor) {

        try {

          const csvResponse =
            await fetch(MASTER_PREKURSOR_URL);

          if (!csvResponse.ok) {
            throw new Error(
              `master_prekursor.csv HTTP ${csvResponse.status}`
            );
          }

          const csvText =
            await csvResponse.text();

          prekursorLookup =
            parsePrekursorCSV(csvText);

          // ---------------------------------------------------
          // OPTIONAL:
          // Data lookup tersedia di HTML melalui JS variable.
          // ---------------------------------------------------

          html =
            injectPrekursorData(
              html,
              prekursorLookup
            );

        } catch (lookupError) {

          return jsonResponse(
            {
              success: false,
              error: "Prekursor lookup failed",
              detail: lookupError.message
            },
            500
          );
        }
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
      // CLOUDFLARE BROWSER
      // =======================================================

      if (!env.BROWSER) {
        throw new Error(
          "BROWSER binding tidak ditemukan di Cloudflare Worker."
        );
      }

      const browser =
        await puppeteer.launch(
          env.BROWSER
        );

      try {

        const page =
          await browser.newPage();

        // -----------------------------------------------------
        // A4
        // -----------------------------------------------------

        await page.setViewport({
          width: 794,
          height: 1123,
          deviceScaleFactor: 1
        });

        // -----------------------------------------------------
        // LOAD HTML
        // -----------------------------------------------------

        await page.setContent(
          html,
          {
            waitUntil: "networkidle0"
          }
        );

        // -----------------------------------------------------
        // PRINT PDF
        // -----------------------------------------------------

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

        // -----------------------------------------------------
        // RETURN BASE64
        // -----------------------------------------------------

        return jsonResponse({
          success: true,

          template:
            selectedTemplate,

          templateURL,

          prekursorLookup:
            isPrekursor
              ? prekursorLookup.length
              : 0,

          pdfBase64:
            uint8ArrayToBase64(pdfBytes)
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

  let result = html;

  for (
    const [key, value]
    of Object.entries(values)
  ) {

    // ---------------------------------------------------------
    // Mendukung:
    //
    // {{Satu}}
    // {{ Dua }}
    // Satu
    // [[Satu]]
    // ---------------------------------------------------------

    const patterns = [

      new RegExp(
        "\\{\\{\\s*" +
        escapeRegExp(key) +
        "\\s*\\}\\}",
        "gi"
      ),

      new RegExp(
        "\\[\\[\\s*" +
        escapeRegExp(key) +
        "\\s*\\]\\]",
        "gi"
      ),

      new RegExp(
        "\\b" +
        escapeRegExp(key) +
        "\\b",
        "g"
      )
    ];

    for (
      const pattern
      of patterns
    ) {

      result =
        result.replace(
          pattern,
          escapeHtml(value)
        );
    }
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

  const json =
    JSON.stringify(data)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026");

  const script = `
<script>
window.PREKURSOR_DATA = ${json};
</script>
`;

  return html.replace(
    "</head>",
    script + "</head>"
  );
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

  let signatureHTML = "";

  // =========================================================
  // BLOCK TTD + STEMPEL
  // =========================================================

  signatureHTML += `
<div id="sp-signature-block"
     style="
       position:absolute;
       right:35mm;
       bottom:20mm;
       width:65mm;
       height:40mm;
       z-index:9999;
       pointer-events:none;
     ">
`;

  // =========================================================
  // STEMPEL
  // =========================================================

  if (stempel) {

    signatureHTML += `
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
/>
`;
  }

  // =========================================================
  // TTD
  // =========================================================

  if (ttd) {

    signatureHTML += `
<img
  src="${ttd}"
  style="
    position:absolute;
    left:17mm;
    bottom:8mm;
    width:42mm;
    height:22mm;
    object-fit:contain;
  "
/>
`;
  }

  signatureHTML += `
</div>
`;

  // =========================================================
  // INSERT BEFORE BODY END
  // =========================================================

  if (
    html.includes("</body>")
  ) {

    return html.replace(
      "</body>",
      signatureHTML + "</body>"
    );

  }

  return html +
    signatureHTML;
}


// =============================================================
// NORMALIZE IMAGE BASE64
// =============================================================

function normalizeImageBase64(
  value
) {

  if (!value) {
    return "";
  }

  let clean =
    String(value).trim();

  // ---------------------------------------------------------
  // Kalau sudah data URI
  // ---------------------------------------------------------

  if (
    clean.startsWith(
      "data:image/"
    )
  ) {

    return clean;
  }

  // ---------------------------------------------------------
  // Deteksi PNG
  // ---------------------------------------------------------

  try {

    const bytes =
      base64ToUint8Array(
        clean
      );

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

    // -------------------------------------------------------
    // JPEG
    // -------------------------------------------------------

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
// CSV PARSER
// =============================================================

function parsePrekursorCSV(
  csv
) {

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
// BASE64
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
// ESCAPE HTML
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
// ESCAPE REGEX
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
      status,
      headers: {
        "content-type":
          "application/json; charset=UTF-8"
      }
    }
  );
}
