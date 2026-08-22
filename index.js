import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getDocument } from "pdfjs-serverless";

const GITHUB_BASE =
  "https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main";

const REGULER_URL =
  `${GITHUB_BASE}/Reguler.pdf`;

const PREKURSOR_URL =
  `${GITHUB_BASE}/Prekursor.pdf`;

const MASTER_URL =
  `${GITHUB_BASE}/master_prekursor.csv`;

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

      const template =
        String(body.template || "")
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
       * ======================================================
       * DOWNLOAD TEMPLATE DARI GITHUB
       * ======================================================
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

      /*
       * ======================================================
       * LOAD TEMPLATE
       * ======================================================
       */

      const pdf =
        await PDFDocument.load(
          templateBytes
        );

      /*
       * ======================================================
       * DATA Satu - Duabelas
       * ======================================================
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
       * ======================================================
       * PREKURSOR
       *
       * PDF UPLOAD
       *      ↓
       * BACA PRODUCT SKU
       *      ↓
       * master_prekursor.csv
       *      ↓
       * Zat Aktif + Bentuk
       * ======================================================
       */

      let lookupInfo = null;

      if (template === "prekursor") {
        const pdfBase64 =
          body.pdfBase64 || "";

        if (!pdfBase64) {
          throw new Error(
            "pdfBase64 wajib dikirim untuk template Prekursor."
          );
        }

        const uploadedPdf =
          base64ToBytes(
            pdfBase64
          );

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

        if (skuList.length === 0) {
          throw new Error(
            "Product SKU tidak ditemukan pada PDF upload."
          );
        }

        const masterCsv =
          await downloadText(
            MASTER_URL
          );

        const master =
          parseCSV(
            masterCsv
          );

        let found = null;
        let foundSKU = "";

        for (const sku of skuList) {
          const row =
            findSKU(
              master,
              sku
            );

          if (row) {
            found = row;
            foundSKU = sku;
            break;
          }
        }

        if (!found) {
          throw new Error(
            `SKU tidak ditemukan di master_prekursor.csv. SKU yang terbaca: ${skuList.join(", ")}`
          );
        }

        const zatAktif =
          firstValue(
            found,
            [
              "Zat Aktif",
              "ZatAktif",
              "ZAT AKTIF",
              "zat aktif"
            ]
          );

        const bentuk =
          firstValue(
            found,
            [
              "Bentuk",
              "BENTUK",
              "bentuk"
            ]
          );

        lookupInfo = {
          productSKU: foundSKU,
          zatAktif,
          bentuk
        };

        /*
         * Kalau template Prekursor juga mempunyai
         * placeholder ZatAktif dan Bentuk,
         * otomatis diisi.
         */
        data.ZatAktif =
          zatAktif;

        data.Bentuk =
          bentuk;
      }

      /*
       * ======================================================
       * REPLACE TEXT
       * ======================================================
       */

      await replacePlaceholders(
        pdf,
        templateBytes,
        data
      );

      /*
       * ======================================================
       * TTD + STEMPEL
       *
       * DICARI BERDASARKAN KEYWORD:
       * "TTD"
       * "Stempel"
       *
       * Jadi tidak bergantung pada koordinat tetap.
       * ======================================================
       */

      await placeSignatureAndStamp(
        pdf,
        templateBytes,
        body.ttdBase64 || "",
        body.stempelBase64 || ""
      );

      /*
       * ======================================================
       * SAVE PDF
       * ======================================================
       */

      const outputBytes =
        await pdf.save();

      const outputBase64 =
        bytesToBase64(
          outputBytes
        );

      const result = {
        success: true,

        message:
          "PDF berhasil diproses.",

        template:
          template === "prekursor"
            ? "Prekursor"
            : "Reguler",

        pages:
          pdf.getPageCount(),

        spBase64:
          outputBase64
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
      data:
        new Uint8Array(
          templateBytes
        ),
      useSystemFonts: true
    }).promise;

  const font =
    await pdf.embedFont(
      StandardFonts.Helvetica
    );

  const pages =
    pdf.getPages();

  for (
    let pageNumber = 1;
    pageNumber <= source.numPages;
    pageNumber++
  ) {
    const sourcePage =
      await source.getPage(
        pageNumber
      );

    const textContent =
      await sourcePage.getTextContent();

    const items =
      textContent.items || [];

    const targetPage =
      pages[pageNumber - 1];

    if (!targetPage) {
      continue;
    }

    for (const key of Object.keys(data)) {
      const value =
        String(
          data[key] ?? ""
        );

      /*
       * Cari placeholder walaupun terpecah
       * menjadi beberapa text item.
       */
      const matches =
        findText(
          items,
          key
        );

      for (const match of matches) {
        const transform =
          match.transform;

        if (!transform) {
          continue;
        }

        const x =
          transform[4];

        const y =
          transform[5];

        const fontSize =
          Math.max(
            6,
            Math.abs(
              transform[3] || 10
            )
          );

        const width =
          Math.max(
            match.width || 0,
            key.length *
              fontSize *
              0.5
          );

        /*
         * Tutup placeholder lama.
         */
        targetPage.drawRectangle({
          x:
            x - 1,

          y:
            y - fontSize - 2,

          width:
            width + 4,

          height:
            fontSize + 5,

          color:
            rgb(
              1,
              1,
              1
            ),

          opacity: 1
        });

        /*
         * Kalau value kosong,
         * placeholder tetap dihapus.
         */
        if (
          value.trim() === ""
        ) {
          continue;
        }

        /*
         * Tulis value baru.
         */
        targetPage.drawText(
          value,
          {
            x,
            y:
              y - fontSize,

            size:
              fontSize,

            font,

            color:
              rgb(
                0,
                0,
                0
              ),

            maxWidth:
              Math.max(
                width + 100,
                100
              ),

            lineHeight:
              fontSize * 1.2
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
 * TTD + STEMPEL
 *
 * Keyword dicari pada template PDF.
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
    const ttdBytes =
      base64ToBytes(
        extractImageBase64(
          ttdInput
        )
      );

    if (isJpg(ttdBytes)) {
      ttdImage =
        await pdf.embedJpg(
          ttdBytes
        );
    } else {
      ttdImage =
        await pdf.embedPng(
          ttdBytes
        );
    }
  }

  /*
   * STEMPEL
   */
  if (stampInput) {
    const stampBytes =
      base64ToBytes(
        extractImageBase64(
          stampInput
        )
      );

    if (isJpg(stampBytes)) {
      stampImage =
        await pdf.embedJpg(
          stampBytes
        );
    } else {
      stampImage =
        await pdf.embedPng(
          stampBytes
        );
    }
  }

  const pdfjs =
    await getPdfJs();

  const source =
    await pdfjs.getDocument({
      data:
        new Uint8Array(
          templateBytes
        ),
      useSystemFonts: true
    }).promise;

  const pages =
    pdf.getPages();

  for (
    let pageNumber = 1;
    pageNumber <= source.numPages;
    pageNumber++
  ) {
    const sourcePage =
      await source.getPage(
        pageNumber
      );

    const textContent =
      await sourcePage.getTextContent();

    const items =
      textContent.items || [];

    const targetPage =
      pages[pageNumber - 1];

    if (!targetPage) {
      continue;
    }

    /*
     * ======================================================
     * TTD
     * ======================================================
     */

    if (ttdImage) {
      const matches =
        findText(
          items,
          "TTD"
        );

      if (matches.length > 0) {
        const match =
          matches[0];

        const x =
          match.transform[4];

        const y =
          match.transform[5];

        /*
         * Hapus keyword TTD.
         */
        targetPage.drawRectangle({
          x:
            x - 3,

          y:
            y - 12,

          width:
            Math.max(
              match.width || 25,
              25
            ) + 6,

          height:
            20,

          color:
            rgb(
              1,
              1,
              1
            )
        });

        /*
         * TTD sedikit di atas keyword.
         */
        targetPage.drawImage(
          ttdImage,
          {
            x:
              x - 15,

            y:
              y + 5,

            width:
              105,

            height:
              55
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
      const matches =
        findText(
          items,
          "Stempel"
        );

      if (matches.length > 0) {
        const match =
          matches[0];

        const x =
          match.transform[4];

        const y =
          match.transform[5];

        /*
         * Hapus keyword Stempel.
         */
        targetPage.drawRectangle({
          x:
            x - 3,

          y:
            y - 12,

          width:
            Math.max(
              match.width || 50,
              50
            ) + 6,

          height:
            20,

          color:
            rgb(
              1,
              1,
              1
            )
        });

        /*
         * Stempel di area keyword.
         */
        targetPage.drawImage(
          stampImage,
          {
            x:
              x - 5,

            y:
              y - 50,

            width:
              85,

            height:
              85,

            opacity:
              0.85
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
 * FIND TEXT
 * ==========================================================
 */

function findText(
  items,
  target
) {
  const results = [];

  /*
   * Kasus normal:
   * placeholder berada dalam satu item.
   */
  for (const item of items) {
    if (
      typeof item.str !== "string"
    ) {
      continue;
    }

    if (
      item.str.includes(
        target
      )
    ) {
      results.push({
        transform:
          item.transform,

        width:
          item.width || 0,

        text:
          item.str
      });
    }
  }

  /*
   * Kasus text terpecah:
   *
   * "Sa" + "tu"
   * "Dua" + "belas"
   */
  for (
    let i = 0;
    i < items.length;
    i++
  ) {
    let combined = "";

    let first = null;
    let last = null;

    for (
      let j = i;
      j < Math.min(
        i + 12,
        items.length
      );
      j++
    ) {
      const item =
        items[j];

      if (
        typeof item.str !== "string"
      ) {
        continue;
      }

      if (!first) {
        first = item;
      }

      combined +=
        item.str;

      last = item;

      if (
        combined.includes(
          target
        )
      ) {
        results.push({
          transform:
            first.transform,

          width:
            combinedWidth(
              first,
              last
            ),

          text:
            combined
        });

        break;
      }
    }
  }

  return removeDuplicates(
    results
  );
}


function combinedWidth(
  first,
  last
) {
  if (
    !first ||
    !last
  ) {
    return 0;
  }

  const x1 =
    first.transform?.[4] || 0;

  const x2 =
    last.transform?.[4] || 0;

  return (
    Math.abs(
      x2 - x1
    ) +
    (last.width || 0)
  );
}


function removeDuplicates(
  items
) {
  const result = [];
  const seen = new Set();

  for (const item of items) {
    const t =
      item.transform || [];

    const key =
      [
        t[4],
        t[5],
        item.text
      ].join("|");

    if (
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);
    result.push(item);
  }

  return result;
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
      data:
        new Uint8Array(
          pdfBytes
        ),
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
 * PDF.JS
 *
 * pdfjs-serverless 1.3.x
 * ==========================================================
 */

let pdfJsPromise = null;

async function getPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise =
      import(
        "pdfjs-serverless"
      );
  }

  return pdfJsPromise;
}


/*
 * ==========================================================
 * SKU
 * ==========================================================
 */

function extractProductSKUs(
  text
) {
  const result = [];

  const normalized =
    String(
      text || ""
    )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  const patterns = [
    /Product\s*SKU\s*[:#-]?\s*([A-Za-z0-9-]+)/i,

    /ProductSKU\s*[:#-]?\s*([A-Za-z0-9-]+)/i,

    /SKU\s*[:#-]?\s*([A-Za-z0-9-]+)/i
  ];

  for (
    const pattern of patterns
  ) {
    const match =
      normalized.match(
        pattern
      );

    if (
      match &&
      match[1]
    ) {
      result.push(
        match[1]
      );
    }
  }

  /*
   * Fallback:
   * cari angka SKU yang umum.
   */
  if (
    result.length === 0
  ) {
    const fallback =
      normalized.match(
        /\b\d{5,12}\b/g
      ) || [];

    result.push(
      ...fallback
    );
  }

  return [
    ...new Set(
      result.map(
        x =>
          String(x)
            .trim()
      )
    )
  ];
}


/*
 * ==========================================================
 * CSV
 * ==========================================================
 */

function parseCSV(
  text
) {
  const cleanText =
    String(
      text || ""
    ).replace(
      /^\uFEFF/,
      ""
    );

  const lines =
    cleanText
      .split(/\r?\n/)
      .filter(
        line =>
          line.trim() !== ""
      );

  if (
    lines.length === 0
  ) {
    return [];
  }

  const headers =
    parseCSVLine(
      lines[0]
    );

  const rows = [];

  for (
    let i = 1;
    i < lines.length;
    i++
  ) {
    const values =
      parseCSVLine(
        lines[i]
      );

    const row = {};

    for (
      let j = 0;
      j < headers.length;
      j++
    ) {
      row[
        headers[j]
      ] =
        values[j] ?? "";
    }

    rows.push(row);
  }

  return rows;
}


function parseCSVLine(
  line
) {
  const result = [];

  let current = "";
  let quoted = false;

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
        quoted &&
        line[i + 1] === '"'
      ) {
        current += '"';
        i++;
      } else {
        quoted =
          !quoted;
      }

    } else if (
      char === "," &&
      !quoted
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


function findSKU(
  rows,
  sku
) {
  const target =
    normalizeSKU(
      sku
    );

  return (
    rows.find(
      row => {
        const values = [
          row["Product SKU"],
          row["ProductSKU"],
          row["SKU"],
          row["Sku"],
          row["sku"]
        ];

        return values.some(
          value =>
            normalizeSKU(
              value
            ) === target
        );
      }
    ) || null
  );
}


function normalizeSKU(
  value
) {
  if (
    value === undefined ||
    value === null
  ) {
    return "";
  }

  return String(
    value
  )
    .trim()
    .replace(
      /^0+/,
      ""
    )
    .toUpperCase();
}


function firstValue(
  object,
  keys
) {
  for (
    const key of keys
  ) {
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

async function downloadBytes(
  url
) {
  const response =
    await fetch(
      url,
      {
        headers: {
          "User-Agent":
            "Guardian-PDF-Worker"
        }
      }
    );

  if (
    !response.ok
  ) {
    throw new Error(
      `Gagal mengambil file GitHub: HTTP ${response.status}`
    );
  }

  return new Uint8Array(
    await response.arrayBuffer()
  );
}


async function downloadText(
  url
) {
  const response =
    await fetch(
      url,
      {
        headers: {
          "User-Agent":
            "Guardian-PDF-Worker"
        }
      }
    );

  if (
    !response.ok
  ) {
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

function base64ToBytes(
  input
) {
  let value =
    String(
      input || ""
    ).trim();

  /*
   * Data URI
   */
  if (
    value.startsWith(
      "data:"
    )
  ) {
    const comma =
      value.indexOf(",");

    if (
      comma !== -1
    ) {
      value =
        value.substring(
          comma + 1
        );
    }
  }

  /*
   * HTML IMG
   */
  const imgMatch =
    value.match(
      /<img[^>]+src=["']data:image\/[^;]+;base64,([^"']+)["']/i
    );

  if (
    imgMatch &&
    imgMatch[1]
  ) {
    value =
      imgMatch[1];
  }

  value =
    value.replace(
      /\s/g,
      ""
    );

  if (!value) {
    throw new Error(
      "Base64 kosong."
    );
  }

  let binary;

  try {
    binary =
      atob(value);
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


function extractImageBase64(
  input
) {
  const value =
    String(
      input || ""
    ).trim();

  const match =
    value.match(
      /<img[^>]+src=["']data:image\/[^;]+;base64,([^"']+)["']/i
    );

  if (
    match &&
    match[1]
  ) {
    return match[1];
  }

  return value;
}


/*
 * ==========================================================
 * BYTES → BASE64
 * ==========================================================
 */

function bytesToBase64(
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

  return btoa(
    binary
  );
}


/*
 * ==========================================================
 * VALIDATE PDF
 * ==========================================================
 */

function validatePdf(
  bytes,
  name
) {
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
      bytes.slice(
        0,
        5
      )
    );

  if (
    header !== "%PDF-"
  ) {
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

function isJpg(
  bytes
) {
  return (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  );
}


/*
 * ==========================================================
 * JSON
 * ==========================================================
 */

function json(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(
      data
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
