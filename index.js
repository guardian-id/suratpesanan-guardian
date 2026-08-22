import puppeteer from "@cloudflare/puppeteer";
import { PDFDocument } from "pdf-lib";

const GITHUB_RAW_BASE = "https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main";

const REGULER_HTML_URL = GITHUB_RAW_BASE + "/Reguler.html";
const PREKURSOR_HTML_URL = GITHUB_RAW_BASE + "/Prekursor.html";
const MASTER_PREKURSOR_URL = GITHUB_RAW_BASE + "/master_prekursor.csv";

export default {
  async fetch(request, env) {
    if (request.method === "GET") {
      return new Response(
        JSON.stringify({
          success: true,
          message: "SP GUARDIAN WORKER OK",
          version: "HTML-PDF-FINAL-1"
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }

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
      const body = await request.json();

      const template = String(
        body.template || "Reguler"
      ).trim().toLowerCase();

      let templateUrl = REGULER_HTML_URL;
      let templateName = "Reguler";

      if (template === "prekursor") {
        templateUrl = PREKURSOR_HTML_URL;
        templateName = "Prekursor";
      }

      const templateResponse = await fetch(templateUrl);

      if (!templateResponse.ok) {
        throw new Error(
          "Gagal mengambil template " +
          templateName +
          ". HTTP " +
          templateResponse.status
        );
      }

      let html = await templateResponse.text();

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

      html = replaceTemplateValues(html, values);

      html = insertSignatureAndStamp(
        html,
        body.ttdBase64 || "",
        body.stempelBase64 || ""
      );

      if (!env.BROWSER) {
        throw new Error(
          "BROWSER binding tidak ditemukan."
        );
      }

      const browser = await puppeteer.launch(env.BROWSER);

      try {
        const page = await browser.newPage();

        await page.setViewport({
          width: 794,
          height: 1123,
          deviceScaleFactor: 1
        });

        await page.setContent(html, {
          waitUntil: "networkidle0"
        });

        const generatedPdf = await page.pdf({
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

        const pdfDoc = await PDFDocument.load(
          generatedPdf
        );

        const finalPdf = await pdfDoc.save();

        return new Response(
          JSON.stringify({
            success: true,
            template: templateName,
            pageCount: pdfDoc.getPageCount(),
            pdfBase64: uint8ArrayToBase64(finalPdf)
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        );
      } finally {
        await browser.close();
      }

    } catch (error) {
      return new Response(
        JSON.stringify({
          success: false,
          error: error?.message || String(error),
          stack: error?.stack || null
        }),
        {
          status: 500,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }
  }
};

function replaceTemplateValues(html, values) {
  let result = String(html);

  for (const [key, value] of Object.entries(values)) {
    const safeValue = escapeHtml(
      String(value ?? "")
    );

    result = result.replace(
      new RegExp(
        "\\{\\{" +
        escapeRegExp(key) +
        "\\}\\}",
        "gi"
      ),
      safeValue
    );

    result = result.replace(
      new RegExp(
        "\\[\\[" +
        escapeRegExp(key) +
        "\\]\\]",
        "gi"
      ),
      safeValue
    );

    result = result.replace(
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

function insertSignatureAndStamp(
  html,
  ttdBase64,
  stempelBase64
) {
  const ttd = normalizeImageBase64(ttdBase64);
  const stempel = normalizeImageBase64(stempelBase64);

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
    ? '<img class="sp-stempel" src="' + stempel + '">'
    : ""
}
${
  ttd
    ? '<img class="sp-ttd" src="' + ttd + '">'
    : ""
}
</div>
`;

  if (html.includes("</body>")) {
    return html.replace(
      "</body>",
      signatureBlock + "</body>"
    );
  }

  return html + signatureBlock;
}

function normalizeImageBase64(value) {
  if (!value) {
    return "";
  }

  const text = String(value).trim();

  if (text.startsWith("data:image/")) {
    return text;
  }

  return "data:image/png;base64," + text;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeRegExp(value) {
  return String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

function uint8ArrayToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;

  for (
    let i = 0;
    i < bytes.length;
    i += chunkSize
  ) {
    binary += String.fromCharCode(
      ...bytes.subarray(
        i,
        Math.min(i + chunkSize, bytes.length)
      )
    );
  }

  return btoa(binary);
}
