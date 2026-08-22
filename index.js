import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getDocument } from "pdfjs-serverless";

const GITHUB_BASE =
  "https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main";

const REGULER_URL = `${GITHUB_BASE}/Reguler.pdf`;
const PREKURSOR_URL = `${GITHUB_BASE}/Prekursor.pdf`;
const MASTER_URL = `${GITHUB_BASE}/master_prekursor.csv`;

const PLACEHOLDERS = [
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

export default {
  async fetch(request) {
    try {
      if (request.method !== "POST") {
        return json(
          {
            success: false,
            message: "Method harus POST."
          },
          405
        );
      }

      const body = await request.json();

      const template = String(body.template || "")
        .trim()
        .toLowerCase();

      if (
        template !== "reguler" &&
        template !== "regular" &&
        template !== "prekursor"
      ) {
        throw new Error(
          `Template tidak dikenal: ${body.template}`
        );
      }

      /*
       * =====================================================
       * 1. AMBIL TEMPLATE DARI GITHUB
       * =====================================================
       */

      const templateUrl =
        template === "prekursor"
          ? PREKURSOR_URL
          : REGULER_URL;

      const templateBytes =
        await downloadBytes(templateUrl);

      validatePdf(
        templateBytes,
        "Template PDF"
      );

      const pdf =
        await PDFDocument.load(
          templateBytes
        );

      /*
       * =====================================================
       * 2. DATA SATU - DUABELAS
       * =====================================================
       */

      const data = {};

      for (const key of PLACEHOLDERS) {
        data[key] =
          body[key] === undefined ||
          body[key] === null
            ? ""
            : String(body[key]);
      }

      /*
       * =====================================================
       * 3. PREKURSOR
       * =====================================================
       */

      let lookupInfo = null;

      if (template === "prekursor") {
        const pdfBase64 =
          String(body.pdfBase64 || "").trim();

        if (!pdfBase64) {
          throw new Error(
            "pdfBase64 wajib dikirim untuk template Prekursor."
          );
        }

        const uploadedPdf =
          base64ToBytes(pdfBase64);

        validatePdf(
          uploadedPdf,
          "pdfBase64"
        );

        const uploadedText =
          await extractPdfText(
            uploadedPdf
          );

        const skuList =
          extractProductSKUs(
            uploadedText
          );

        if (!skuList.length) {
          throw new Error(
            "Product SKU tidak ditemukan pada PDF upload."
          );
        }

        const masterCsv =
          await downloadText(
            MASTER_URL
          );

        const master =
          parseCSV(masterCsv);

        let found = null;
        let foundSKU = "";

        for (const sku of skuList) {
          const row =
            findSKU(master, sku);

          if (row) {
            found = row;
            foundSKU = sku;
            break;
          }
        }

        if (!found) {
          throw new Error(
            "SKU tidak ditemukan di master_prekursor.csv. " +
            `SKU terbaca: ${skuList.join(", ")}`
          );
        }

        const zatAktif =
          firstValue(found, [
            "Zat Aktif",
            "ZatAktif",
            "ZAT AKTIF",
            "zat aktif"
          ]);

        const bentuk =
          firstValue(found, [
            "Bentuk",
            "BENTUK",
            "bentuk"
          ]);

        lookupInfo = {
          productSKU: foundSKU,
          zatAktif,
          bentuk
        };

        data.ZatAktif = zatAktif;
        data.Bentuk = bentuk;
      }

      /*
       * =====================================================
       * 4. REPLACE SATU-DUABELAS
       * =====================================================
       */

      await replacePlaceholders(
        pdf,
        templateBytes,
        data
      );

      /*
       * =====================================================
       * 5. TTD + STEMPEL
       * =====================================================
       */

      await placeSignatureAndStamp(
        pdf,
        templateBytes,
        body.ttdBase64 || "",
        body.stempelBase64 || ""
      );

      /*
       * =====================================================
       * 6. OUTPUT
       * =====================================================
       */

      const outputBytes =
        await pdf.save({
          useObjectStreams: false
        });

      const outputBase64 =
        bytesToBase64(outputBytes);

      const result = {
        success: true,
        message: "PDF berhasil diproses.",
        template:
          template === "prekursor"
            ? "Prekursor"
            : "Reguler",
        pages: pdf.getPageCount(),
        spBase64: outputBase64
      };

      if (lookupInfo) {
        result.productSKU =
          lookupInfo.productSKU;

        result.zatAktif =
          lookupInfo.zatAktif;

        result.bentuk =
          lookupInfo.bentuk;
      }

      return json(result);

    } catch (error) {
      return json(
        {
          success: false,
          message:
            error?.message ||
            "Terjadi error pada Worker."
        },
        500
      );
    }
  }
};


/*
 * ==========================================================
 * REPLACE PLACEHOLDERS
 *
 * PENTING:
 * Setiap placeholder hanya diproses SATU KALI.
 * Tidak ada lagi kombinasi text item seperti versi lama.
 * ==========================================================
 */

async function replacePlaceholders(
  pdf,
  templateBytes,
  data
) {
  const pdfjs =
    await getPdfJs();

  const source =
    await pdfjs.getDocument({
      data: new Uint8Array(templateBytes),
      useSystemFonts: true
    }).promise;

  const font =
    await pdf.embedFont(
      StandardFonts.Helvetica
    );

  const pages =
    pdf.getPages();

  for (
    let pageIndex = 0;
    pageIndex < source.numPages;
    pageIndex++
  ) {
    const sourcePage =
      await source.getPage(
        pageIndex + 1
      );

    const textContent =
      await sourcePage.getTextContent();

    const items =
      (textContent.items || [])
        .filter(
          item =>
            typeof item.str === "string" &&
            item.str.trim() !== ""
        );

    const targetPage =
      pages[pageIndex];

    if (!targetPage) {
      continue;
    }

    /*
     * Set lokasi yang sudah diproses.
     * Ini mencegah TEST SATU berulang.
     */
    const processed = new Set();

    for (const key of PLACEHOLDERS) {
      const value =
        String(data[key] ?? "");

      /*
       * HANYA exact item.
       */
      const item =
        items.find(
          x =>
            String(x.str).trim() === key
        );

      if (!item) {
        continue;
      }

      const transform =
        item.transform;

      if (!transform) {
        continue;
      }

      const x =
        Number(transform[4] || 0);

      const y =
        Number(transform[5] || 0);

      const fontSize =
        Math.max(
          6,
          Math.abs(
            Number(transform[3] || 10)
          )
        );

      const width =
        Math.max(
          Number(item.width || 0),
          key.length * fontSize * 0.45
        );

      const locationKey =
        [
          Math.round(x * 100),
          Math.round(y * 100),
          key
        ].join("|");

      if (
        processed.has(locationKey)
      ) {
        continue;
      }

      processed.add(locationKey);

      /*
       * Tutup placeholder saja.
       */
      targetPage.drawRectangle({
        x: x - 1,
        y: y - fontSize - 2,
        width: width + 3,
        height: fontSize + 5,
        color: rgb(1, 1, 1)
      });

      /*
       * Kalau kosong, cukup hapus placeholder.
       */
      if (!value.trim()) {
        continue;
      }

      /*
       * Tulis nilai baru SATU KALI.
       */
      targetPage.drawText(
        value,
        {
          x: x,
          y: y - fontSize + 1,
          size: fontSize,
          font: font,
          color: rgb(0, 0, 0)
        }
      );
    }
  }

  try {
    await source.destroy();
  } catch (_) {}
}


/*
 * ==========================================================
 * TTD + STEMPEL
 * ==========================================================
 */

async function placeSignatureAndStamp(
  pdf,
  templateBytes,
  ttdInput,
  stampInput
) {
  if (
    !ttdInput &&
    !stampInput
  ) {
    return;
  }

  let ttdImage = null;
  let stampImage = null;

  /*
   * TTD
   */
  if (ttdInput) {
    const bytes =
      base64ToBytes(
        extractImageBase64(
          ttdInput
        )
      );

    if (isJpg(bytes)) {
      ttdImage =
        await pdf.embedJpg(bytes);
    } else {
      ttdImage =
        await pdf.embedPng(bytes);
    }
  }

  /*
   * STEMPEL
   */
  if (stampInput) {
    const bytes =
      base64ToBytes(
        extractImageBase64(
          stampInput
        )
      );

    if (isJpg(bytes)) {
      stampImage =
        await pdf.embedJpg(bytes);
    } else {
      stampImage =
        await pdf.embedPng(bytes);
    }
  }

  const pdfjs =
    await getPdfJs();

  const source =
    await pdfjs.getDocument({
      data: new Uint8Array(templateBytes),
      useSystemFonts: true
    }).promise;

  const pages =
    pdf.getPages();

  for (
    let pageIndex = 0;
    pageIndex < source.numPages;
    pageIndex++
  ) {
    const sourcePage =
      await source.getPage(
        pageIndex + 1
      );

    const textContent =
      await sourcePage.getTextContent();

    const items =
      (textContent.items || [])
        .filter(
          item =>
            typeof item.str === "string"
        );

    const targetPage =
      pages[pageIndex];

    if (!targetPage) {
      continue;
    }

    /*
     * ======================================================
     * TTD
     * ======================================================
     */

    if (ttdImage) {
      const item =
        items.find(
          x =>
            String(x.str)
              .trim()
              .toLowerCase() === "ttd"
        );

      if (item && item.transform) {
        const x =
          Number(item.transform[4] || 0);

        const y =
          Number(item.transform[5] || 0);

        const width =
          Math.max(
            Number(item.width || 0),
            20
          );

        /*
         * Hapus keyword TTD.
         */
        targetPage.drawRectangle({
          x: x - 2,
          y: y - 14,
          width: width + 4,
          height: 18,
          color: rgb(1, 1, 1)
        });

        /*
         * TTD.
         */
        targetPage.drawImage(
          ttdImage,
          {
            x: x - 10,
            y: y + 2,
            width: 105,
            height: 55
          }
        );
      }
    }

    /*
     * ======================================================
     * STEMPEL
     * ======================================================
     */

    if (stampImage) {
      const item =
        items.find(
          x =>
            String(x.str)
              .trim()
              .toLowerCase() === "stempel"
        );

      if (item && item.transform) {
        const x =
          Number(item.transform[4] || 0);

        const y =
          Number(item.transform[5] || 0);

        const width =
          Math.max(
            Number(item.width || 0),
            30
          );

        /*
         * Hapus keyword Stempel.
         */
        targetPage.drawRectangle({
          x: x - 2,
          y: y - 14,
          width: width + 4,
          height: 18,
          color: rgb(1, 1, 1)
        });

        /*
         * Stempel.
         */
        targetPage.drawImage(
          stampImage,
          {
            x: x - 5,
            y: y - 45,
            width: 85,
            height: 85,
            opacity: 0.85
          }
        );
      }
    }
  }

  try {
    await source.destroy();
  } catch (_) {}
}


/*
 * ==========================================================
 * PDF.JS
 * ==========================================================
 */

let pdfJsPromise = null;

async function getPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise =
      import("pdfjs-serverless");
  }

  return pdfJsPromise;
}


/*
 * ==========================================================
 * EXTRACT PDF TEXT
 * ==========================================================
 */

async function extractPdfText(
  pdfBytes
) {
  const pdfjs =
    await getPdfJs();

  const document =
    await pdfjs.getDocument({
      data: new Uint8Array(pdfBytes),
      useSystemFonts: true
    }).promise;

  const pages = [];

  for (
    let i = 1;
    i <= document.numPages;
    i++
  ) {
    const page =
      await document.getPage(i);

    const content =
      await page.getTextContent();

    const text =
      content.items
        .map(
          item =>
            typeof item.str === "string"
              ? item.str
              : ""
        )
        .join(" ");

    pages.push(text);
  }

  try {
    await document.destroy();
  } catch (_) {}

  return pages.join("\n");
}


/*
 * ==========================================================
 * SKU
 * ==========================================================
 */

function extractProductSKUs(text) {
  const normalized =
    String(text || "")
      .replace(/\s+/g, " ")
      .trim();

  const result = [];

  const patterns = [
    /Product\s*SKU\s*[:#-]?\s*([A-Za-z0-9-]+)/i,
    /ProductSKU\s*[:#-]?\s*([A-Za-z0-9-]+)/i,
    /SKU\s*[:#-]?\s*([A-Za-z0-9-]+)/i
  ];

  for (const pattern of patterns) {
    const match =
      normalized.match(pattern);

    if (match?.[1]) {
      result.push(match[1]);
    }
  }

  if (!result.length) {
    const fallback =
      normalized.match(
        /\b\d{5,12}\b/g
      ) || [];

    result.push(...fallback);
  }

  return [
    ...new Set(
      result.map(
        x => String(x).trim()
      )
    )
  ];
}


/*
 * ==========================================================
 * CSV
 * ==========================================================
 */

function parseCSV(text) {
  const clean =
    String(text || "")
      .replace(/^\uFEFF/, "");

  const lines =
    clean
      .split(/\r?\n/)
      .filter(
        line => line.trim() !== ""
      );

  if (!lines.length) {
    return [];
  }

  const headers =
    parseCSVLine(lines[0]);

  const rows = [];

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
      row[headers[j]] =
        values[j] ?? "";
    }

    rows.push(row);
  }

  return rows;
}


function parseCSVLine(line) {
  const result = [];

  let current = "";
  let quoted = false;

  for (
    let i = 0;
    i < line.length;
    i++
  ) {
    const char = line[i];

    if (char === '"') {
      if (
        quoted &&
        line[i + 1] === '"'
      ) {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (
      char === "," &&
      !quoted
    ) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());

  return result;
}


function findSKU(rows, sku) {
  const target =
    normalizeSKU(sku);

  return (
    rows.find(row => {
      const values = [
        row["Product SKU"],
        row["ProductSKU"],
        row["SKU"],
        row["Sku"],
        row["sku"]
      ];

      return values.some(
        value =>
          normalizeSKU(value) === target
      );
    }) || null
  );
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


function firstValue(object, keys) {
  for (const key of keys) {
    if (
      object[key] !== undefined &&
      object[key] !== null
    ) {
      return String(
        object[key]
      ).trim();
    }
  }

  return "";
}


/*
 * ==========================================================
 * DOWNLOAD
 * ==========================================================
 */

async function downloadBytes(url) {
  const response =
    await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Gagal mengambil file GitHub: HTTP ${response.status}`
    );
  }

  return new Uint8Array(
    await response.arrayBuffer()
  );
}


async function downloadText(url) {
  const response =
    await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Gagal mengambil CSV: HTTP ${response.status}`
    );
  }

  return response.text();
}


/*
 * ==========================================================
 * BASE64
 * ==========================================================
 */

function base64ToBytes(input) {
  let value =
    String(input || "").trim();

  /*
   * HTML IMG
   */
  const img =
    value.match(
      /<img[^>]+src=["']data:image\/[^;]+;base64,([^"']+)["']/i
    );

  if (img?.[1]) {
    value = img[1];
  }

  /*
   * Data URI
   */
  if (
    value.startsWith("data:")
  ) {
    const comma =
      value.indexOf(",");

    if (comma >= 0) {
      value =
        value.substring(
          comma + 1
        );
    }
  }

  value =
    value.replace(/\s/g, "");

  if (!value) {
    throw new Error(
      "Base64 kosong."
    );
  }

  let binary;

  try {
    binary = atob(value);
  } catch (_) {
    throw new Error(
      "Base64 tidak valid."
    );
  }

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


function extractImageBase64(input) {
  const value =
    String(input || "").trim();

  const match =
    value.match(
      /<img[^>]+src=["']data:image\/[^;]+;base64,([^"']+)["']/i
    );

  if (match?.[1]) {
    return match[1];
  }

  return value;
}


/*
 * ==========================================================
 * BYTES → BASE64
 * ==========================================================
 */

function bytesToBase64(bytes) {
  let binary = "";

  const chunkSize = 0x8000;

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


/*
 * ==========================================================
 * VALIDATE PDF
 * ==========================================================
 */

function validatePdf(bytes, name) {
  if (
    !bytes ||
    bytes.length < 5
  ) {
    throw new Error(
      `${name} kosong.`
    );
  }

  const header =
    new TextDecoder().decode(
      bytes.slice(0, 5)
    );

  if (header !== "%PDF-") {
    throw new Error(
      `${name} bukan PDF valid.`
    );
  }
}


/*
 * ==========================================================
 * JPG
 * ==========================================================
 */

function isJpg(bytes) {
  return (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  );
}


/*
 * ==========================================================
 * JSON RESPONSE
 * ==========================================================
 */

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8"
      }
    }
  );
}
