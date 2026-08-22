import puppeteer from "@cloudflare/puppeteer";

const REGULER_HTML_URL =
  "https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main/Reguler.html";

export default {
  async fetch(request, env) {

    // ================================
    // HEALTH CHECK
    // ================================

    if (request.method === "GET") {
      return new Response(
        JSON.stringify({
          success: true,
          message: "SP GUARDIAN WORKER OK",
          version: "REGULER-ONLY"
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }

    // ================================
    // ONLY POST
    // ================================

    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Method not allowed"
        }),
        {
          status: 405,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }

    try {

      // ================================
      // READ JSON
      // ================================

      const body = await request.json();

      // ================================
      // VALUES
      // ================================

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

      const ttdBase64 =
        body.ttdBase64 || "";

      const stempelBase64 =
        body.stempelBase64 || "";

      // ================================
      // DOWNLOAD HTML
      // ================================

      const response =
        await fetch(REGULER_HTML_URL);

      if (!response.ok) {
        throw new Error(
          "Reguler.html gagal diambil. HTTP " +
          response.status
        );
      }

      let html =
        await response.text();

      // ================================
      // REPLACE PLACEHOLDERS
      // ================================

      html =
        replaceValues(
          html,
          values
        );

      // ================================
      // ADD TTD + STEMPEL
      // ================================

      html =
        addSignature(
          html,
          ttdBase64,
          stempelBase64
        );

      // ================================
      // CHECK BROWSER
      // ================================

      if (!env.BROWSER) {
        throw new Error(
          "BROWSER binding tidak ditemukan."
        );
      }

      // ================================
      // START BROWSER
      // ================================

      const browser =
        await puppeteer.launch(
          env.BROWSER
        );

      try {

        const page =
          await browser.newPage();

        // ==============================
        // A4
        // ==============================

        await page.setViewport({
          width: 794,
          height: 1123,
          deviceScaleFactor: 1
        });

        // ==============================
        // HTML
        // ==============================

        await page.setContent(
          html,
          {
            waitUntil: "networkidle0"
          }
        );

        // ==============================
        // PDF
        // ==============================

        const pdf =
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

        await browser.close();

        // ==============================
        // RESPONSE
        // ==============================

        return new Response(
          JSON.stringify({
            success: true,
            template: "Reguler",
            pdfBase64:
              toBase64(pdf)
          }),
          {
            status: 200,
            headers: {
              "content-type":
                "application/json"
            }
          }
        );

      } catch (error) {

        try {
          await browser.close();
        } catch (_) {}

        throw error;
      }

    } catch (error) {

      return new Response(
        JSON.stringify({
          success: false,
          error:
            error?.message ||
            String(error)
        }),
        {
          status: 500,
          headers: {
            "content-type":
              "application/json"
          }
        }
      );
    }
  }
};


// ========================================
// REPLACE VALUES
// ========================================

function replaceValues(
  html,
  values
) {

  let result =
    String(html);

  for (
    const key in values
  ) {

    const value =
      escapeHtml(
        String(values[key] ?? "")
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
        value
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
        value
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
        value
      );
  }

  return result;
}


// ========================================
// TTD + STEMPEL
// ========================================

function addSignature(
  html,
  ttdBase64,
  stempelBase64
) {

  const ttd =
    normalizeImage(
      ttdBase64
    );

  const stempel =
    normalizeImage(
      stempelBase64
    );

  if (!ttd && !stempel) {
    return html;
  }

  const block = `

<style>

.sp-signature {
  position: absolute;
  right: 25mm;
  bottom: 22mm;
  width: 55mm;
  height: 35mm;
  z-index: 9999;
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

<div class="sp-signature">

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

  if (
    html.includes("</body>")
  ) {
    return html.replace(
      "</body>",
      block +
      "</body>"
    );
  }

  return html + block;
}


// ========================================
// NORMALIZE IMAGE
// ========================================

function normalizeImage(
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


// ========================================
// HTML ESCAPE
// ========================================

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


// ========================================
// REGEX ESCAPE
// ========================================

function escapeRegExp(
  value
) {

  return String(value)
    .replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );
}


// ========================================
// UINT8ARRAY TO BASE64
// ========================================

function toBase64(
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
