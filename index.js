import puppeteer from "@cloudflare/puppeteer";

const GITHUB_BASE =
  "https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main";

function cleanBase64(value) {
  if (!value) return "";

  if (typeof value !== "string") {
    throw new Error("Base64 harus berupa string");
  }

  return value
    .replace(/^data:.*?;base64,/, "")
    .replace(/^<img[^>]+src=["']data:.*?;base64,/, "")
    .replace(/["'>\s]/g, "");
}

function escapeHtml(value) {
  if (value === null || value === undefined) return "";

  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function replacePlaceholders(html, data) {
  let result = html;

  for (let i = 1; i <= 12; i++) {
    const key = `S${numberToWord(i)}`;
    const value = data[key] ?? "";

    result = result.replaceAll(
      `{{${key}}}`,
      escapeHtml(value)
    );

    result = result.replaceAll(
      `[[${key}]]`,
      escapeHtml(value)
    );

    result = result.replaceAll(
      `__${key}__`,
      escapeHtml(value)
    );
  }

  return result;
}

function numberToWord(number) {
  const words = [
    "",
    "Satu",
    "Dua",
    "Tiga",
    "Empat",
    "Lima",
    "Enam",
    "Tujuh",
    "Delapan",
    "Sembilan",
    "Sepuluh",
    "Sebelas",
    "Duabelas"
  ];

  return words[number];
}

async function getTemplate(template) {
  const name =
    String(template || "Reguler")
      .replace(".html", "")
      .replace(".pdf", "")
      .trim()
      .toLowerCase();

  let fileName = "Reguler.html";

  if (name === "prekursor") {
    fileName = "Prekursor.html";
  }

  const url = `${GITHUB_BASE}/${fileName}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Template ${fileName} gagal diambil dari GitHub. HTTP ${response.status}`
    );
  }

  return await response.text();
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8"
    }
  });
}

export default {
  async fetch(request, env) {
    try {
      if (request.method === "GET") {
        return jsonResponse({
          success: true,
          worker: "SP GUARDIAN",
          status: "online",
          message: "Worker siap menerima POST JSON"
        });
      }

      if (request.method !== "POST") {
        return jsonResponse(
          {
            success: false,
            error: "Method harus POST"
          },
          405
        );
      }

      const contentType =
        request.headers.get("content-type") || "";

      if (!contentType.includes("application/json")) {
        return jsonResponse(
          {
            success: false,
            error: "Content-Type harus application/json"
          },
          400
        );
      }

      const body = await request.json();

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

      if (!pdfBase64) {
        return jsonResponse(
          {
            success: false,
            error: "pdfBase64 tidak ditemukan"
          },
          400
        );
      }

      const data = {
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
      };

      const templateHtml = await getTemplate(template);

      let html = replacePlaceholders(
        templateHtml,
        data
      );

      /*
       * TTD + STEMPEL
       *
       * Untuk tahap awal kita hanya menyisipkan
       * gambar jika template mempunyai placeholder:
       *
       * {{TTD_STEMPEL}}
       */

      if (ttdBase64 || stempelBase64) {
        const ttd = cleanBase64(ttdBase64);
        const stempel = cleanBase64(stempelBase64);

        let imageHtml = "";

        if (ttd) {
          imageHtml += `
            <img
              src="data:image/png;base64,${ttd}"
              style="
                max-width:170px;
                max-height:100px;
                display:block;
              "
            />
          `;
        }

        if (stempel) {
          imageHtml += `
            <img
              src="data:image/png;base64,${stempel}"
              style="
                max-width:170px;
                max-height:100px;
                display:block;
                margin-top:-25px;
              "
            />
          `;
        }

        html = html.replaceAll(
          "{{TTD_STEMPEL}}",
          `
          <div
            style="
              position:relative;
              width:180px;
              height:120px;
            "
          >
            ${imageHtml}
          </div>
          `
        );
      }

      /*
       * Browser Run
       */

      if (!env.BROWSER) {
        return jsonResponse(
          {
            success: false,
            error: "Binding BROWSER belum tersedia"
          },
          500
        );
      }

      const browser =
        await puppeteer.launch(env.BROWSER);

      try {
        const page = await browser.newPage();

        await page.setContent(html, {
          waitUntil: "networkidle0"
        });

        await page.setViewport({
          width: 794,
          height: 1123,
          deviceScaleFactor: 1
        });

        const pdf = await page.pdf({
          format: "A4",
          printBackground: true,
          preferCSSPageSize: true,
          margin: {
            top: "0",
            right: "0",
            bottom: "0",
            left: "0"
          }
        });

        const base64Pdf =
          uint8ArrayToBase64(pdf);

        return jsonResponse({
          success: true,
          template:
            template || "Reguler",
          pdfBase64: base64Pdf,
          pdfLength: base64Pdf.length
        });
      } finally {
        await browser.close();
      }

    } catch (error) {
      return jsonResponse(
        {
          success: false,
          error: error?.message || String(error)
        },
        500
      );
    }
  }
};

function uint8ArrayToBase64(bytes) {
  let binary = "";

  const chunkSize = 0x8000;

  for (
    let i = 0;
    i < bytes.length;
    i += chunkSize
  ) {
    const chunk = bytes.subarray(
      i,
      Math.min(i + chunkSize, bytes.length)
    );

    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}
