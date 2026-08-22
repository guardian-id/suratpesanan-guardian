import puppeteer from "@cloudflare/puppeteer";

const GITHUB_RAW_BASE =
  "https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main";

const REGULER_HTML_URL =
  GITHUB_RAW_BASE + "/Reguler.html";

export default {
  async fetch(request, env) {

    // ==========================================================
    // GET - HEALTH CHECK
    // ==========================================================

    if (request.method === "GET") {
      return jsonResponse({
        success: true,
        message: "SP GUARDIAN WORKER OK",
        version: "REGULER-HTML-1"
      });
    }

    // ==========================================================
    // ONLY POST
    // ==========================================================

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

      // ========================================================
      // READ JSON
      // ========================================================

      const body = await request.json();

      if (!body || typeof body !== "object") {
        return jsonResponse(
          {
            success: false,
            error: "Invalid JSON body"
          },
          400
        );
      }

      // ========================================================
      // INPUT
      // ========================================================

      const ttdBase64 =
        body.ttdBase64 || "";

      const stempelBase64 =
        body.stempelBase64 || "";

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

      // ========================================================
      // LOAD REGULER.HTML FROM GITHUB
      // ========================================================

      const templateResponse =
        await fetch(REGULER_HTML_URL);

      if (!templateResponse.ok) {
        throw new Error(
          "Gagal mengambil Reguler.html. HTTP " +
          templateResponse.status
        );
      }

      let html =
        await templateResponse.text();

      // ========================================================
      // REPLACE PLACEHOLDERS
      // Support:
      // {{Satu}}
      // [[Satu]]
      // ${Satu}
      // ========================================================

      html =
        replaceTemplateValues(
          html,
          values
        );

      // ========================================================
      // INSERT TTD + STEMPEL
      // ========================================================

      html =
        insertSignatureAndStamp(
          html,
          ttdBase64,
          stempelBase64
        );

      // ========================================================
      // CHECK BROWSER
      // ========================================================

      if (!env.BROWSER) {
        throw new Error(
          "BROWSER binding tidak ditemukan. Periksa konfigurasi Cloudflare."
        );
      }

      // ========================================================
      // LAUNCH BROWSER
      // ========================================================

      const browser =
        await puppeteer.launch(
          env.BROWSER
        );

      try {

        // ======================================================
        // NEW PAGE
        // ======================================================

        const page =
          await browser.newPage();

        // ======================================================
        // VIEWPORT
        // ======================================================

        await page.setViewport({
          width: 794,
          height: 1123,
          deviceScaleFactor: 1
        });

        // ======================================================
        // LOAD HTML
        // ======================================================

        await page.setContent(
          html,
          {
            waitUntil: "networkidle0"
          }
        );

        // ======================================================
        // GENERATE A4 PDF
        // ======================================================

        const pdfBytes =
          await page.pdf({
            format: "A4",

            printBackground: true,

            margin: {
              top: "0mm",
              right: "0mm",
              bottom: "0mm",
              left: "0mm"
            },

            preferCSSPageSize: true
          });

        // ======================================================
        // CLOSE BROWSER
        // ======================================================

        await browser.close();

        // ======================================================
        // RETURN PDF BASE64
        // ======================================================

        return jsonResponse({
          success: true,

          template: "Reguler",

          pdfBase64:
            uint8ArrayToBase64(pdfBytes)
        });

      } catch (browserError) {

        try {
          await browser.close();
        } catch (_) {}

        throw browserError;
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


// ============================================================
// REPLACE TEMPLATE VALUES
// ============================================================

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

    const safeValue =
      escapeHtml(
        String(value ?? "")
      );

    // {{Satu}}
    result =
      result.replace(
        new RegExp(
          "\\{\\{" +
          escapeRegExp(key) +
          "\\}\\}",
          "gi"
        ),
        safeValue
      );

    // [[Satu]]
    result =
      result.replace(
        new RegExp(
          "\\[\\[" +
          escapeRegExp(key) +
          "\\]\\]",
          "gi"
        ),
        safeValue
      );

    // ${Satu}
    result =
      result.replace(
        new RegExp(
          "\\$\\{" +
          escapeRegExp(key) +
          "\\}",
          "gi"
        ),
        safeValue
      );
  }

  return result;
}


// ============================================================
// INSERT TTD + STEMPEL
// ============================================================

function insertSignatureAndStamp(
  html,
  ttdBase64,
  stempelBase64
) {

  const ttd =
    normalizeImageBase64(
      ttdBase64
    );

  const stempel =
    normalizeImageBase64(
      stempelBase64
    );

  if (!ttd && !stempel) {
    return html;
  }

  const signatureBlock = `

<style>

.sp-signature-block {
  position: absolute;
  right: 25mm;
  bottom: 22mm;
  width: 55mm;
  height: 35mm;
  z-index: 9999;
  pointer-events: none;
}

.sp-stempel {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 25mm;
  height: 25mm;
  object-fit: contain;
}

.sp-ttd {
  position: absolute;
  left: 12mm;
  bottom: 8mm;
  width: 40mm;
  height: 22mm;
  object-fit: contain;
}

</style>

<div class="sp-signature-block">

${
  stempel
    ? '<img class="sp-stempel" src="' +
      stempel +
      '">'
    : ''
}

${
  ttd
    ? '<img class="sp-ttd" src="' +
      ttd +
      '">'
    : ''
}

</div>

`;

  if (html.includes("</body>")) {

    return html.replace(
      "</body>",
      signatureBlock +
      "</body>"
    );
  }

  return html +
    signatureBlock;
}


// ============================================================
// NORMALIZE IMAGE BASE64
// ============================================================

function normalizeImageBase64(
  value
) {

  if (!value) {
    return "";
  }

  const text =
    String(value).trim();

  if (
    text.startsWith(
      "data:image/"
    )
  ) {
    return text;
  }

  return (
    "data:image/png;base64," +
    text
  );
}


// ============================================================
// HTML ESCAPE
// ============================================================

function escapeHtml(value) {

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

function escapeRegExp(value) {

  return String(value)
    .replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );
}


// ============================================================
// UINT8 ARRAY → BASE64
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


// ============================================================
// JSON RESPONSE
// ============================================================

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
