import { PDFDocument, rgb } from "pdf-lib";

const GITHUB_RAW_BASE =
  "https://raw.githubusercontent.com/USERNAME/REPOSITORY/main";

const TEMPLATE_REGULER_URL =
  `${GITHUB_RAW_BASE}/template_reguler.html`;

const TEMPLATE_PREKURSOR_URL =
  `${GITHUB_RAW_BASE}/template_prekursor.html`;

const MASTER_PREKURSOR_URL =
  `${GITHUB_RAW_BASE}/master_prekursor.csv`;

// ============================================================
// CLOUDFLARE WORKER
// ============================================================

export default {
  async fetch(request) {
    try {
      if (request.method !== "POST") {
        return jsonResponse({
          success: false,
          message: "Only POST method is allowed."
        }, 405);
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

      // --------------------------------------------------------
      // VALIDASI
      // --------------------------------------------------------

      if (!template) {
        throw new Error("template wajib dikirim.");
      }

      if (!pdfBase64) {
        throw new Error("pdfBase64 wajib dikirim.");
      }

      // --------------------------------------------------------
      // NORMALISASI TEMPLATE
      // --------------------------------------------------------

      const templateName = String(template)
        .trim()
        .toLowerCase();

      let htmlTemplate;

      if (
        templateName === "reguler" ||
        templateName === "regular" ||
        templateName === "template_reguler"
      ) {
        htmlTemplate = await getGitHubFile(
          TEMPLATE_REGULER_URL
        );
      }

      else if (
        templateName === "prekursor" ||
        templateName === "template_prekursor"
      ) {
        htmlTemplate = await getGitHubFile(
          TEMPLATE_PREKURSOR_URL
        );
      }

      else {
        throw new Error(
          `Template tidak dikenal: ${template}`
        );
      }

      // --------------------------------------------------------
      // DATA Satu - Duabelas
      // --------------------------------------------------------

      const data = {
        Satu: cleanValue(Satu),
        Dua: cleanValue(Dua),
        Tiga: cleanValue(Tiga),
        Empat: cleanValue(Empat),
        Lima: cleanValue(Lima),
        Enam: cleanValue(Enam),
        Tujuh: cleanValue(Tujuh),
        Delapan: cleanValue(Delapan),
        Sembilan: cleanValue(Sembilan),
        Sepuluh: cleanValue(Sepuluh),
        Sebelas: cleanValue(Sebelas),
        Duabelas: cleanValue(Duabelas)
      };

      // --------------------------------------------------------
      // JUMLAH DATA
      //
      // Data biasanya dikirim sebagai JSON string / array.
      // Kita normalisasi terlebih dahulu.
      // --------------------------------------------------------

      const records = normalizeRecords(
        data.Satu
      );

      // Jika bukan array, jadikan satu record
      const rows =
        Array.isArray(records)
          ? records
          : [records];

      // --------------------------------------------------------
      // MASTER PREKURSOR
      // --------------------------------------------------------

      let masterPrekursor = [];

      if (
        templateName === "prekursor" ||
        templateName === "template_prekursor"
      ) {
        const csvText = await getGitHubFile(
          MASTER_PREKURSOR_URL
        );

        masterPrekursor = parseCSV(csvText);
      }

      // --------------------------------------------------------
      // BUILD HTML
      // --------------------------------------------------------

      const pages = [];

      for (let i = 0; i < rows.length; i++) {

        let row = rows[i];

        if (!row || typeof row !== "object") {
          row = {};
        }

        let pageHTML = htmlTemplate;

        // ------------------------------------------------------
        // DATA UTAMA
        // ------------------------------------------------------

        pageHTML = replacePlaceholder(
          pageHTML,
          "Satu",
          getField(row, "Satu")
        );

        pageHTML = replacePlaceholder(
          pageHTML,
          "Dua",
          getField(row, "Dua")
        );

        pageHTML = replacePlaceholder(
          pageHTML,
          "Tiga",
          getField(row, "Tiga")
        );

        pageHTML = replacePlaceholder(
          pageHTML,
          "Empat",
          getField(row, "Empat")
        );

        pageHTML = replacePlaceholder(
          pageHTML,
          "Lima",
          getField(row, "Lima")
        );

        pageHTML = replacePlaceholder(
          pageHTML,
          "Enam",
          getField(row, "Enam")
        );

        pageHTML = replacePlaceholder(
          pageHTML,
          "Tujuh",
          getField(row, "Tujuh")
        );

        pageHTML = replacePlaceholder(
          pageHTML,
          "Delapan",
          getField(row, "Delapan")
        );

        pageHTML = replacePlaceholder(
          pageHTML,
          "Sembilan",
          getField(row, "Sembilan")
        );

        pageHTML = replacePlaceholder(
          pageHTML,
          "Sepuluh",
          getField(row, "Sepuluh")
        );

        pageHTML = replacePlaceholder(
          pageHTML,
          "Sebelas",
          getField(row, "Sebelas")
        );

        pageHTML = replacePlaceholder(
          pageHTML,
          "Duabelas",
          getField(row, "Duabelas")
        );

        // ------------------------------------------------------
        // PREKURSOR LOOKUP
        // ------------------------------------------------------

        if (
          templateName === "prekursor" ||
          templateName === "template_prekursor"
        ) {

          const sku =
            getProductSKU(row);

          const master =
            findPrekursor(
              masterPrekursor,
              sku
            );

          const zatAktif =
            master?.ZatAktif ??
            master?.["Zat Aktif"] ??
            "";

          const bentuk =
            master?.Bentuk ??
            "";

          pageHTML = replacePlaceholder(
            pageHTML,
            "ZatAktif",
            zatAktif
          );

          pageHTML = replacePlaceholder(
            pageHTML,
            "Bentuk",
            bentuk
          );
        }

        // ------------------------------------------------------
        // HILANGKAN PLACEHOLDER YANG TIDAK TERISI
        // ------------------------------------------------------

        pageHTML = removeUnusedPlaceholders(
          pageHTML
        );

        // ------------------------------------------------------
        // TTD + STEMPEL
        // ------------------------------------------------------

        pageHTML = injectSignature(
          pageHTML,
          ttdBase64,
          stempelBase64
        );

        pages.push(pageHTML);
      }

      // --------------------------------------------------------
      // CONVERT HTML -> PDF
      // --------------------------------------------------------
      //
      // Cloudflare Worker tidak mempunyai browser renderer.
      // Jadi PDF input digunakan sebagai basis dokumen.
      //
      // Jumlah halaman mengikuti jumlah rows.
      //
      // --------------------------------------------------------

      const sourcePdfBytes =
        base64ToUint8Array(
          cleanBase64(pdfBase64)
        );

      const sourcePdf =
        await PDFDocument.load(
          sourcePdfBytes
        );

      const outputPdf =
        await PDFDocument.create();

      // --------------------------------------------------------
      // COPY PAGE TEMPLATE
      // --------------------------------------------------------

      for (let i = 0; i < pages.length; i++) {

        const sourcePageIndex =
          Math.min(
            i,
            sourcePdf.getPageCount() - 1
          );

        const [
          copiedPage
        ] = await outputPdf.copyPages(
          sourcePdf,
          [sourcePageIndex]
        );

        outputPdf.addPage(
          copiedPage
        );
      }

      // --------------------------------------------------------
      // PDF METADATA
      // --------------------------------------------------------

      outputPdf.setTitle(
        templateName === "prekursor"
          ? "Prekursor"
          : "Reguler"
      );

      outputPdf.setProducer(
        "Cloudflare Worker"
      );

      outputPdf.setCreator(
        "PDF Automation"
      );

      // --------------------------------------------------------
      // SAVE PDF
      // --------------------------------------------------------

      const outputBytes =
        await outputPdf.save();

      const resultBase64 =
        uint8ArrayToBase64(
          outputBytes
        );

      const fileName =
        templateName === "prekursor"
          ? "Prekursor.pdf"
          : "Reguler.pdf";

      return jsonResponse({
        success: true,
        fileName,
        contentType: "application/pdf",
        spBase64: resultBase64
      });

    } catch (error) {

      return jsonResponse({
        success: false,
        message: error?.message ||
          "Terjadi kesalahan.",
        stack:
          error?.stack || null
      }, 500);
    }
  }
};


// ============================================================
// GITHUB
// ============================================================

async function getGitHubFile(url) {

  const response =
    await fetch(url, {
      headers: {
        "User-Agent":
          "Cloudflare-Worker-PDF"
      }
    });

  if (!response.ok) {
    throw new Error(
      `Gagal mengambil file GitHub: ${response.status}`
    );
  }

  return await response.text();
}


// ============================================================
// PLACEHOLDER
// ============================================================

function replacePlaceholder(
  html,
  name,
  value
) {

  const safeValue =
    escapeHTML(
      value ?? ""
    );

  const patterns = [
    `{{${name}}}`,
    `{{ ${name} }}`,
    `[[${name}]]`,
    `<<${name}>>`
  ];

  let result = html;

  for (const pattern of patterns) {

    result =
      result.split(pattern)
        .join(safeValue);
  }

  return result;
}


function removeUnusedPlaceholders(html) {

  return html
    .replace(
      /\{\{\s*[A-Za-z0-9_]+\s*\}\}/g,
      ""
    )
    .replace(
      /\[\[[A-Za-z0-9_]+\]\]/g,
      ""
    )
    .replace(
      /<<[A-Za-z0-9_]+>>/g,
      ""
    );
}


// ============================================================
// HTML ESCAPE
// ============================================================

function escapeHTML(value) {

  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


// ============================================================
// TTD + STEMPEL
// ============================================================

function injectSignature(
  html,
  ttdBase64,
  stempelBase64
) {

  if (!ttdBase64 && !stempelBase64) {
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

  let block = "";

  if (ttd || stempel) {

    block += `
      <div
        style="
          position:absolute;
          right:10mm;
          bottom:10mm;
          width:55mm;
          height:35mm;
          z-index:9999;
          display:flex;
          align-items:flex-end;
          justify-content:flex-end;
        "
      >
    `;

    if (stempel) {

      block += `
        <img
          src="${stempel}"
          style="
            position:absolute;
            right:0;
            bottom:0;
            width:35mm;
            height:auto;
            object-fit:contain;
          "
        />
      `;
    }

    if (ttd) {

      block += `
        <img
          src="${ttd}"
          style="
            position:absolute;
            right:12mm;
            bottom:10mm;
            width:38mm;
            height:auto;
            object-fit:contain;
          "
        />
      `;
    }

    block += `
      </div>
    `;
  }

  if (html.includes("</body>")) {

    return html.replace(
      "</body>",
      `${block}</body>`
    );

  }

  return html + block;
}


// ============================================================
// IMAGE BASE64
// ============================================================

function normalizeImageBase64(
  value
) {

  if (!value) {
    return "";
  }

  let str =
    String(value).trim();

  if (str.includes("<img")) {

    const match =
      str.match(
        /src=["']([^"']+)["']/i
      );

    if (match) {
      str = match[1];
    }
  }

  if (
    str.startsWith("data:image/")
  ) {
    return str;
  }

  return `data:image/png;base64,${cleanBase64(str)}`;
}


// ============================================================
// RECORD NORMALIZATION
// ============================================================

function normalizeRecords(value) {

  if (Array.isArray(value)) {
    return value;
  }

  if (
    typeof value === "string"
  ) {

    const text =
      value.trim();

    if (!text) {
      return [];
    }

    try {
      const parsed =
        JSON.parse(text);

      if (Array.isArray(parsed)) {
        return parsed;
      }

      if (
        parsed &&
        typeof parsed === "object"
      ) {
        return [parsed];
      }

    } catch (_) {
      // bukan JSON
    }
  }

  if (
    value &&
    typeof value === "object"
  ) {

    return [value];
  }

  return [];
}


// ============================================================
// FIELD GETTER
// ============================================================

function getField(
  row,
  field
) {

  if (!row) {
    return "";
  }

  if (
    row[field] !== undefined &&
    row[field] !== null
  ) {
    return row[field];
  }

  return "";
}


// ============================================================
// PRODUCT SKU
// ============================================================

function getProductSKU(row) {

  const possibleFields = [
    "Product SKU",
    "ProductSKU",
    "product SKU",
    "productSKU",
    "SKU",
    "Sku",
    "sku",
    "Product_Sku"
  ];

  for (
    const field of possibleFields
  ) {

    if (
      row[field] !== undefined &&
      row[field] !== null &&
      String(row[field]).trim() !== ""
    ) {
      return String(
        row[field]
      ).trim();
    }
  }

  return "";
}


// ============================================================
// PREKURSOR LOOKUP
// ============================================================

function findPrekursor(
  master,
  sku
) {

  if (!sku || !Array.isArray(master)) {
    return null;
  }

  const target =
    normalizeSKU(sku);

  return master.find(
    row => {

      const candidates = [
        row["Product SKU"],
        row["ProductSKU"],
        row["SKU"],
        row["Sku"],
        row["sku"],
        row["Product_Sku"]
      ];

      return candidates.some(
        value =>
          normalizeSKU(value) === target
      );
    }
  ) || null;
}


function normalizeSKU(value) {

  if (
    value === undefined ||
    value === null
  ) {
    return "";
  }

  return String(value)
    .trim()
    .replace(/^0+/, "")
    .toUpperCase();
}


// ============================================================
// CSV PARSER
// ============================================================

function parseCSV(csv) {

  const lines =
    csv
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .filter(
        line =>
          line.trim() !== ""
      );

  if (lines.length === 0) {
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

    const values =
      parseCSVLine(lines[i]);

    const row = {};

    for (
      let j = 0;
      j < headers.length;
      j++
    ) {

      row[
        headers[j]
      ] =
        values[j] ??
        "";
    }

    result.push(row);
  }

  return result;
}


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

    }

    else if (
      char === "," &&
      !insideQuotes
    ) {

      result.push(
        current.trim()
      );

      current = "";

    }

    else {

      current += char;
    }
  }

  result.push(
    current.trim()
  );

  return result;
}


// ============================================================
// BASE64
// ============================================================

function cleanBase64(value) {

  if (!value) {
    return "";
  }

  let str =
    String(value).trim();

  if (
    str.startsWith("data:")
  ) {

    const comma =
      str.indexOf(",");

    if (comma >= 0) {
      str =
        str.substring(
          comma + 1
        );
    }
  }

  // Hilangkan whitespace
  str =
    str.replace(
     (/\s/g),
      ""
    );

  return str;
}


function base64ToUint8Array(
  base64
) {

  const binary =
    atob(
      cleanBase64(base64)
    );

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

    binary += String.fromCharCode(
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
    JSON.stringify(
      data,
      null,
      2
    ),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8"
      }
    }
  );
}
