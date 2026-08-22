import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const GITHUB_RAW_BASE =
  "https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main";

const MASTER_PREKURSOR_URL =
  `${GITHUB_RAW_BASE}/master_prekursor.csv`;

export default {
  async fetch(request, env, ctx) {

    // =========================================================
    // GET = HEALTH CHECK
    // =========================================================
    if (request.method === "GET") {
      return jsonResponse({
        success: true,
        message: "SP GUARDIAN WORKER OK",
        worker: "suratpesanan-guardian",
        version: "FINAL-1"
      });
    }

    // =========================================================
    // ONLY POST
    // =========================================================
    if (request.method !== "POST") {
      return jsonResponse({
        success: false,
        error: "Method not allowed"
      }, 405);
    }

    try {

      // =======================================================
      // READ JSON
      // =======================================================
      const body = await request.json();

      // =======================================================
      // BASIC VALIDATION
      // =======================================================
      if (!body || typeof body !== "object") {
        return jsonResponse({
          success: false,
          error: "Invalid request body"
        }, 400);
      }

      // =======================================================
      // GET PARAMETERS
      // =======================================================
      const {
        pdfBase64,
        ttdBase64,
        stempelBase64,
        template,

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
      // PDF REQUIRED
      // =======================================================
      if (!pdfBase64) {
        return jsonResponse({
          success: false,
          error: "pdfBase64 is required"
        }, 400);
      }

      // =======================================================
      // DETERMINE TEMPLATE
      // =======================================================
      const selectedTemplate =
        String(template || "Reguler").trim().toLowerCase();

      const isPrekursor =
        selectedTemplate === "prekursor";

      // =======================================================
      // DATA OBJECT
      // =======================================================
      const values = {
        Satu: Satu ?? "",
        Dua: Dua ?? "",
        Tiga: Tiga ?? "",
        Empat: Empat ?? "",
        Lima: Lima ?? "",
        Enam: Enam ?? "",
        Tujuh: Tujuh ?? "",
        Delapan: Delapan ?? "",
        Sembilan: Sembilan ?? "",
        Sepuluh: Sepuluh ?? "",
        Sebelas: Sebelas ?? "",
        Duabelas: Duabelas ?? ""
      };

      // =======================================================
      // PREKURSOR LOOKUP
      // =======================================================
      let prekursorResult = null;

      if (isPrekursor) {

        try {

          const csvResponse = await fetch(MASTER_PREKURSOR_URL);

          if (!csvResponse.ok) {
            throw new Error(
              `Failed to load master_prekursor.csv (${csvResponse.status})`
            );
          }

          const csvText = await csvResponse.text();

          prekursorResult = parsePrekursorCSV(csvText);

        } catch (lookupError) {

          return jsonResponse({
            success: false,
            error: "Prekursor lookup failed",
            detail: lookupError.message
          }, 500);
        }
      }

      // =======================================================
      // DECODE PDF
      // =======================================================
      const pdfBytes = base64ToUint8Array(pdfBase64);

      // =======================================================
      // LOAD PDF
      // =======================================================
      const pdfDoc = await PDFDocument.load(pdfBytes);

      // =======================================================
      // EMBED FONT
      // =======================================================
      const font = await pdfDoc.embedFont(
        StandardFonts.Helvetica
      );

      // =======================================================
      // PROCESS ALL PAGES
      // =======================================================
      const pages = pdfDoc.getPages();

      for (const page of pages) {

        processPage(
          page,
          values,
          font
        );

      }

      // =======================================================
      // TTD + STEMPEL
      // =======================================================
      if (ttdBase64 || stempelBase64) {

        await applySignatureAndStamp(
          pdfDoc,
          ttdBase64,
          stempelBase64
        );

      }

      // =======================================================
      // SAVE PDF
      // =======================================================
      const outputPdf = await pdfDoc.save();

      // =======================================================
      // RETURN BASE64
      // =======================================================
      return jsonResponse({
        success: true,

        template: isPrekursor
          ? "Prekursor"
          : "Reguler",

        pageCount: pages.length,

        prekursorLookup:
          isPrekursor
            ? prekursorResult?.length ?? 0
            : 0,

        pdfBase64: uint8ArrayToBase64(outputPdf)
      });

    } catch (error) {

      return jsonResponse({
        success: false,
        error: error?.message || String(error),
        stack: error?.stack || null
      }, 500);
    }
  }
};


// =============================================================
// PROCESS PDF PAGE
// =============================================================

function processPage(page, values, font) {

  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();

  /*
   * TEMPORARY POSITION MAP
   *
   * Nanti kita sesuaikan dengan koordinat template PDF
   * Reguler.pdf dan Prekursor.pdf.
   *
   * Untuk sekarang placeholder dibuat berdasarkan
   * nama field.
   */

  const positions = {

    Satu: {
      x: 50,
      y: pageHeight - 100
    },

    Dua: {
      x: 50,
      y: pageHeight - 120
    },

    Tiga: {
      x: 50,
      y: pageHeight - 140
    },

    Empat: {
      x: 50,
      y: pageHeight - 160
    },

    Lima: {
      x: 50,
      y: pageHeight - 180
    },

    Enam: {
      x: 50,
      y: pageHeight - 200
    },

    Tujuh: {
      x: 50,
      y: pageHeight - 220
    },

    Delapan: {
      x: 50,
      y: pageHeight - 240
    },

    Sembilan: {
      x: 50,
      y: pageHeight - 260
    },

    Sepuluh: {
      x: 50,
      y: pageHeight - 280
    },

    Sebelas: {
      x: 50,
      y: pageHeight - 300
    },

    Duabelas: {
      x: 50,
      y: pageHeight - 320
    }
  };

  for (const [key, position] of Object.entries(positions)) {

    const value = values[key];

    if (
      value === null ||
      value === undefined ||
      String(value).trim() === ""
    ) {
      continue;
    }

    page.drawText(
      String(value),
      {
        x: position.x,
        y: position.y,
        size: 9,
        font,
        color: rgb(0, 0, 0)
      }
    );
  }
}


// =============================================================
// TTD + STEMPEL
// =============================================================

async function applySignatureAndStamp(
  pdfDoc,
  ttdBase64,
  stempelBase64
) {

  let ttdImage = null;
  let stempelImage = null;

  if (ttdBase64) {
    ttdImage = await embedImage(
      pdfDoc,
      ttdBase64
    );
  }

  if (stempelBase64) {
    stempelImage = await embedImage(
      pdfDoc,
      stempelBase64
    );
  }

  const pages = pdfDoc.getPages();

  for (const page of pages) {

    const pageWidth = page.getWidth();

    /*
     * POSISI DASAR TTD/STEMPEL
     *
     * Nanti kita sesuaikan lagi dengan template.
     */

    const blockWidth = 170;
    const blockHeight = 90;

    const x =
      pageWidth - blockWidth - 35;

    const y = 55;

    if (stempelImage) {

      page.drawImage(
        stempelImage,
        {
          x: x,
          y: y,
          width: 85,
          height: 85
        }
      );

    }

    if (ttdImage) {

      page.drawImage(
        ttdImage,
        {
          x: x + 45,
          y: y + 15,
          width: 110,
          height: 55
        }
      );

    }
  }
}


// =============================================================
// EMBED IMAGE
// =============================================================

async function embedImage(pdfDoc, base64) {

  let clean = String(base64);

  // HTML IMG
  const imgMatch =
    clean.match(
      /data:image\/([a-zA-Z0-9.+-]+);base64,([^"]+)/i
    );

  if (imgMatch) {
    clean = imgMatch[2];

    const format =
      imgMatch[1].toLowerCase();

    const bytes =
      base64ToUint8Array(clean);

    if (format === "jpg" || format === "jpeg") {
      return await pdfDoc.embedJpg(bytes);
    }

    return await pdfDoc.embedPng(bytes);
  }

  // Remove data URI prefix
  clean = clean.replace(
    /^data:image\/[^;]+;base64,/i,
    ""
  );

  const bytes =
    base64ToUint8Array(clean);

  // PNG signature
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4E &&
    bytes[3] === 0x47
  ) {

    return await pdfDoc.embedPng(bytes);
  }

  // JPEG signature
  if (
    bytes[0] === 0xFF &&
    bytes[1] === 0xD8
  ) {

    return await pdfDoc.embedJpg(bytes);
  }

  throw new Error(
    "Unsupported image format. Only PNG/JPEG are supported."
  );
}


// =============================================================
// PREKURSOR CSV PARSER
// =============================================================

function parsePrekursorCSV(csv) {

  const lines =
    csv
      .split(/\r?\n/)
      .filter(line => line.trim() !== "");

  if (lines.length < 2) {
    return [];
  }

  const headers =
    parseCSVLine(lines[0]);

  const result = [];

  for (let i = 1; i < lines.length; i++) {

    const columns =
      parseCSVLine(lines[i]);

    const row = {};

    headers.forEach(
      (header, index) => {

        row[header] =
          columns[index] ?? "";

      }
    );

    result.push(row);
  }

  return result;
}


// =============================================================
// CSV LINE PARSER
// =============================================================

function parseCSVLine(line) {

  const result = [];

  let current = "";
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {

    const char = line[i];

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
// BASE64 → UINT8ARRAY
// =============================================================

function base64ToUint8Array(base64) {

  const binary =
    atob(
      String(base64)
        .replace(/^data:.*?;base64,/i, "")
        .replace(/\s/g, "")
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


// =============================================================
// UINT8ARRAY → BASE64
// =============================================================

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

function jsonResponse(data, status = 200) {

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
