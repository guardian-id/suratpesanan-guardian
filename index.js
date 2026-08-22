import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getDocument } from "pdfjs-serverless";

/* ============================================================
   GITHUB
   ============================================================ */

const GITHUB_BASE =
  "https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main";

const REGULER_URL =
  `${GITHUB_BASE}/Reguler.pdf`;

const PREKURSOR_URL =
  `${GITHUB_BASE}/Prekursor.pdf`;

const MASTER_URL =
  `${GITHUB_BASE}/master_prekursor.csv`;


/* ============================================================
   WORKER
   ============================================================ */

export default {

  async fetch(request) {

    try {

      if (request.method !== "POST") {
        return json({
          success: false,
          message: "Method harus POST."
        }, 405);
      }

      const body =
        await request.json();


      /* ======================================================
         INPUT
         ====================================================== */

      const template =
        String(body.template || "")
          .trim()
          .toLowerCase();


      if (!template) {
        throw new Error(
          "template wajib dikirim."
        );
      }


      const pdfBase64 =
        body.pdfBase64 || "";


      if (!pdfBase64) {
        throw new Error(
          "pdfBase64 wajib dikirim."
        );
      }


      const ttdBase64 =
        body.ttdBase64 || "";


      const stempelBase64 =
        body.stempelBase64 || "";


      /* ======================================================
         1. PDF UPLOAD DARI POWER AUTOMATE
         
         PDF INI BUKAN TEMPLATE OUTPUT.
         
         PDF INI DIGUNAKAN SEBAGAI:
         - sumber Product SKU
         - sumber data dokumen
         ====================================================== */

      const uploadedPDFBytes =
        base64ToBytes(
          pdfBase64
        );


      validatePDF(
        uploadedPDFBytes,
        "pdfBase64"
      );


      /* ======================================================
         2. BACA TEXT PDF UPLOAD
         ====================================================== */

      const uploadedText =
        await extractPDFText(
          uploadedPDFBytes
        );


      /* ======================================================
         3. PILIH TEMPLATE GITHUB
         ====================================================== */

      let templateURL;

      if (
        template === "reguler" ||
        template === "regular"
      ) {

        templateURL =
          REGULER_URL;

      } else if (
        template === "prekursor"
      ) {

        templateURL =
          PREKURSOR_URL;

      } else {

        throw new Error(
          `Template tidak dikenal: ${body.template}`
        );
      }


      /* ======================================================
         4. DOWNLOAD TEMPLATE OUTPUT DARI GITHUB
         ====================================================== */

      const templateBytes =
        await downloadBytes(
          templateURL
        );


      validatePDF(
        templateBytes,
        "template GitHub"
      );


      /* ======================================================
         5. LOAD TEMPLATE
         ====================================================== */

      const pdf =
        await PDFDocument.load(
          templateBytes
        );


      /* ======================================================
         6. DATA Satu - Duabelas
         ====================================================== */

      const data = {

        Satu:
          clean(body.Satu),

        Dua:
          clean(body.Dua),

        Tiga:
          clean(body.Tiga),

        Empat:
          clean(body.Empat),

        Lima:
          clean(body.Lima),

        Enam:
          clean(body.Enam),

        Tujuh:
          clean(body.Tujuh),

        Delapan:
          clean(body.Delapan),

        Sembilan:
          clean(body.Sembilan),

        Sepuluh:
          clean(body.Sepuluh),

        Sebelas:
          clean(body.Sebelas),

        Duabelas:
          clean(body.Duabelas)
      };


      /* ======================================================
         7. PREKURSOR LOOKUP
         ====================================================== */

      let skuFound = "";
      let zatAktif = "";
      let bentuk = "";


      if (
        template === "prekursor"
      ) {

        /*
         * Cari Product SKU dari PDF upload.
         */

        const skuList =
          extractSKUsFromText(
            uploadedText
          );


        if (
          skuList.length === 0
        ) {

          throw new Error(
            "Product SKU tidak ditemukan pada PDF upload."
          );
        }


        /*
         * Download master CSV.
         */

        const masterCSV =
          await downloadText(
            MASTER_URL
          );


        const master =
          parseCSV(
            masterCSV
          );


        /*
         * Cari SKU yang cocok.
         */

        let found = null;


        for (
          const sku of skuList
        ) {

          found =
            findSKU(
              master,
              sku
            );


          if (found) {

            skuFound =
              sku;

            break;
          }
        }


        if (!found) {

          throw new Error(
            `Product SKU tidak ditemukan di master_prekursor.csv. SKU dari PDF: ${skuList.join(", ")}`
          );
        }


        zatAktif =
          firstValue(
            found,
            [
              "Zat Aktif",
              "ZatAktif",
              "ZAT AKTIF",
              "zat aktif"
            ]
          );


        bentuk =
          firstValue(
            found,
            [
              "Bentuk",
              "BENTUK",
              "bentuk"
            ]
          );
      }


      /* ======================================================
         8. REPLACE TEXT BIASA
         
         Placeholder:
         Satu
         Dua
         ...
         Duabelas
         
         + untuk Prekursor:
         ZatAktif
         Bentuk
         ====================================================== */

      const replacementData = {

        ...data

      };


      if (
        template === "prekursor"
      ) {

        replacementData.ZatAktif =
          zatAktif;

        replacementData.Bentuk =
          bentuk;
      }


      await replacePDFPlaceholders(
        pdf,
        templateBytes,
        replacementData
      );


      /* ======================================================
         9. TTD + STEMPEL
         ====================================================== */

      await addTTDAndStamp(
        pdf,
        ttdBase64,
        stempelBase64
      );


      /* ======================================================
         10. SAVE FINAL PDF
         ====================================================== */

      const output =
        await pdf.save();


      const outputBase64 =
        bytesToBase64(
          output
        );


      /* ======================================================
         11. RESPONSE
         ====================================================== */

      const fileName =
        template === "prekursor"
          ? "Prekursor.pdf"
          : "Reguler.pdf";


      return json({

        success: true,

        fileName,

        contentType:
          "application/pdf",

        pages:
          pdf.getPageCount(),

        ...(template === "prekursor"
          ? {
              productSKU:
                skuFound,

              zatAktif,

              bentuk
            }
          }
          : {}),

        spBase64:
          outputBase64
      });


    } catch (error) {

      return json({

        success: false,

        message:
          error?.message ||
          "Terjadi error pada Worker."

      }, 500);
    }
  }
};


/* ============================================================
   EXTRACT TEXT FROM PDF
   ============================================================ */

async function extractPDFText(
  pdfBytes
) {

  const loadingTask =
    getDocument({

      data:
        new Uint8Array(
          pdfBytes
        ),

      useSystemFonts:
        true
    });


  const document =
    await loadingTask.promise;


  const pages = [];


  for (
    let pageNumber = 1;
    pageNumber <= document.numPages;
    pageNumber++
  ) {

    const page =
      await document.getPage(
        pageNumber
      );


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


    pages.push(
      text
    );
  }


  try {
    await document.destroy();
  } catch (_) {}


  return pages.join(
    "\n"
  );
}


/* ============================================================
   REPLACE TEXT PLACEHOLDERS
   ============================================================ */

async function replacePDFPlaceholders(
  pdf,
  originalBytes,
  data
) {

  /*
   * Baca template GitHub dengan PDF.js
   * untuk mendapatkan posisi teks.
   */

  const loadingTask =
    getDocument({

      data:
        new Uint8Array(
          originalBytes
        ),

      useSystemFonts:
        true
    });


  const sourcePdf =
    await loadingTask.promise;


  const font =
    await pdf.embedFont(
      StandardFonts.Helvetica
    );


  const pages =
    pdf.getPages();


  for (
    let pageIndex = 0;
    pageIndex < sourcePdf.numPages;
    pageIndex++
  ) {

    const sourcePage =
      await sourcePdf.getPage(
        pageIndex + 1
      );


    const content =
      await sourcePage.getTextContent();


    const items =
      content.items || [];


    const targetPage =
      pages[pageIndex];


    if (!targetPage) {
      continue;
    }


    for (
      const [placeholder, rawValue]
      of Object.entries(data)
    ) {

      if (
        rawValue === undefined ||
        rawValue === null
      ) {
        continue;
      }


      const value =
        String(
          rawValue
        );


      /*
       * Cari placeholder.
       */

      const matches =
        findTextMatches(
          items,
          placeholder
        );


      for (
        const match of matches
      ) {

        const transform =
          match.transform;


        const x =
          transform[4];


        const fontSize =
          Math.max(
            6,
            Math.abs(
              transform[3]
            ) || 10
          );


        const y =
          transform[5] -
          fontSize;


        const placeholderWidth =
          Math.max(
            match.width || 0,
            placeholder.length *
            fontSize *
            0.5
          );


        const height =
          fontSize * 1.35;


        /*
         * Tutup teks placeholder.
         */

        targetPage.drawRectangle({

          x:
            x - 1,

          y:
            y - 2,

          width:
            placeholderWidth + 4,

          height:
            height + 4,

          color:
            rgb(1, 1, 1),

          borderWidth:
            0
        });


        /*
         * Kalau nilai kosong,
         * placeholder cukup dihapus.
         */

        if (
          value === ""
        ) {
          continue;
        }


        /*
         * Tulis nilai baru.
         */

        targetPage.drawText(
          value,
          {

            x,

            y,

            size:
              fontSize,

            font,

            color:
              rgb(0, 0, 0),

            maxWidth:
              Math.max(
                placeholderWidth + 100,
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
    await sourcePdf.destroy();
  } catch (_) {}
}


/* ============================================================
   FIND TEXT MATCHES
   ============================================================ */

function findTextMatches(
  items,
  target
) {

  const result = [];


  /*
   * ==========================================================
   * MODE 1
   * Placeholder utuh dalam satu text item
   * ==========================================================
   */

  for (
    const item of items
  ) {

    if (
      typeof item.str !== "string"
    ) {
      continue;
    }


    if (
      item.str.includes(target)
    ) {

      result.push({

        transform:
          item.transform,

        width:
          item.width || 0,

        str:
          item.str

      });
    }
  }


  /*
   * ==========================================================
   * MODE 2
   * Placeholder terpecah
   *
   * Contoh:
   *
   * "Sa" + "tu"
   * ==========================================================
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


      last =
        item;


      if (
        combined.includes(target)
      ) {

        result.push({

          transform:
            first.transform,

          width:
            calculateCombinedWidth(
              first,
              last
            ),

          str:
            combined

        });


        break;
      }
    }
  }


  return removeDuplicateMatches(
    result
  );
}


/* ============================================================
   REMOVE DUPLICATE MATCHES
   ============================================================ */

function removeDuplicateMatches(
  matches
) {

  const result = [];

  const seen =
    new Set();


  for (
    const match
    of matches
  ) {

    const key =
      [
        match.transform?.[4],
        match.transform?.[5],
        match.str
      ].join("|");


    if (
      seen.has(key)
    ) {
      continue;
    }


    seen.add(key);

    result.push(
      match
    );
  }


  return result;
}


/* ============================================================
   WIDTH
   ============================================================ */

function calculateCombinedWidth(
  first,
  last
) {

  const x1 =
    first.transform[4];


  const x2 =
    last.transform[4];


  return Math.abs(
    x2 - x1
  ) +
  (last.width || 0);
}


/* ============================================================
   EXTRACT SKU FROM PDF TEXT
   ============================================================ */

function extractSKUsFromText(
  text
) {

  const result = [];


  /*
   * Product SKU biasanya muncul
   * sebagai angka 6-12 digit.
   *
   * Kita ambil angka yang terlihat
   * di sekitar label Product SKU.
   */

  const normalized =
    text
      .replace(
        /\s+/g,
        " "
      )
      .trim();


  const skuPatterns = [

    /Product\s*SKU\s*[:#-]?\s*([A-Za-z0-9-]+)/i,

    /ProductSKU\s*[:#-]?\s*([A-Za-z0-9-]+)/i,

    /SKU\s*[:#-]?\s*([A-Za-z0-9-]+)/i

  ];


  for (
    const pattern
    of skuPatterns
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
   * Hilangkan duplicate.
   */

  return [
    ...new Set(
      result
        .map(
          x =>
            String(x).trim()
        )
        .filter(Boolean)
    )
  ];
}


/* ============================================================
   SKU LOOKUP
   ============================================================ */

function findSKU(
  rows,
  sku
) {

  const target =
    normalizeSKU(
      sku
    );


  return rows.find(
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
  ) || null;
}


/* ============================================================
   NORMALIZE SKU
   ============================================================ */

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


/* ============================================================
   CSV VALUE
   ============================================================ */

function firstValue(
  object,
  keys
) {

  for (
    const key
    of keys
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


/* ============================================================
   CSV PARSER
   ============================================================ */

function parseCSV(
  text
) {

  text =
    text.replace(
      /^\uFEFF/,
      ""
    );


  const lines =
    text
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


    rows.push(
      row
    );
  }


  return rows;
}


/* ============================================================
   CSV LINE
   ============================================================ */

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


/* ============================================================
   TTD + STEMPEL
   ============================================================ */

async function addTTDAndStamp(
  pdf,
  ttdBase64,
  stempelBase64
) {

  if (
    !ttdBase64 &&
    !stempelBase64
  ) {
    return;
  }


  let ttd = null;

  let stamp = null;


  /* ----------------------------------------------------------
     TTD
     ---------------------------------------------------------- */

  if (
    ttdBase64
  ) {

    const bytes =
      base64ToBytes(
        ttdBase64
      );


    validateImage(
      bytes,
      "ttdBase64"
    );


    if (
      isJPG(bytes)
    ) {

      ttd =
        await pdf.embedJpg(
          bytes
        );

    } else {

      ttd =
        await pdf.embedPng(
          bytes
        );
    }
  }


  /* ----------------------------------------------------------
     STEMPEL
     ---------------------------------------------------------- */

  if (
    stempelBase64
  ) {

    const bytes =
      base64ToBytes(
        stempelBase64
      );


    validateImage(
      bytes,
      "stempelBase64"
    );


    if (
      isJPG(bytes)
    ) {

      stamp =
        await pdf.embedJpg(
          bytes
        );

    } else {

      stamp =
        await pdf.embedPng(
          bytes
        );
    }
  }


  /* ----------------------------------------------------------
     DRAW
     ---------------------------------------------------------- */

  const pages =
    pdf.getPages();


  for (
    const page
    of pages
  ) {

    const {
      width
    } =
      page.getSize();


    /*
     * STEMPEL
     */

    if (stamp) {

      page.drawImage(
        stamp,
        {

          x:
            width - 130,

          y:
            45,

          width:
            90,

          height:
            90,

          opacity:
            0.85
        }
      );
    }


    /*
     * TTD
     */

    if (ttd) {

      page.drawImage(
        ttd,
        {

          x:
            width - 120,

          y:
            55,

          width:
            105,

          height:
            55
        }
      );
    }
  }
}


/* ============================================================
   DOWNLOAD BINARY
   ============================================================ */

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
      `Gagal mengambil file: ${url} (${response.status})`
    );
  }


  return new Uint8Array(
    await response.arrayBuffer()
  );
}


/* ============================================================
   DOWNLOAD TEXT
   ============================================================ */

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
      `Gagal mengambil CSV: ${response.status}`
    );
  }


  return await response.text();
}


/* ============================================================
   BASE64 → BYTES
   ============================================================ */

function base64ToBytes(
  value
) {

  let text =
    String(
      value || ""
    ).trim();


  /*
   * Support:
   *
   * data:application/pdf;base64,...
   * data:image/png;base64,...
   * data:image/jpeg;base64,...
   */

  if (
    text.startsWith("data:")
  ) {

    const comma =
      text.indexOf(",");


    if (
      comma !== -1
    ) {

      text =
        text.substring(
          comma + 1
        );
    }
  }


  text =
    text.replace(
      /\s/g,
      ""
    );


  if (
    !text
  ) {

    throw new Error(
      "Base64 kosong."
    );
  }


  let binary;


  try {

    binary =
      atob(
        text
      );

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


/* ============================================================
   BYTES → BASE64
   ============================================================ */

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


/* ============================================================
   VALIDATE PDF
   ============================================================ */

function validatePDF(
  bytes,
  name
) {

  if (
    !bytes ||
    bytes.length < 5
  ) {

    throw new Error(
      `${name} kosong atau terlalu kecil.`
    );
  }


  const header =
    new TextDecoder()
      .decode(
        bytes.slice(
          0,
          5
        )
      );


  if (
    header !== "%PDF-"
  ) {

    throw new Error(
      `${name} bukan PDF yang valid.`
    );
  }
}


/* ============================================================
   IMAGE TYPE
   ============================================================ */

function isJPG(
  bytes
) {

  return (
    bytes.length >= 3 &&
    bytes[0] === 0xFF &&
    bytes[1] === 0xD8 &&
    bytes[2] === 0xFF
  );
}


/* ============================================================
   VALIDATE IMAGE
   ============================================================ */

function validateImage(
  bytes,
  name
) {

  const png =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4E &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0D &&
    bytes[5] === 0x0A &&
    bytes[6] === 0x1A &&
    bytes[7] === 0x0A;


  const jpg =
    isJPG(bytes);


  if (
    !png &&
    !jpg
  ) {

    throw new Error(
      `${name} bukan PNG/JPG yang valid.`
    );
  }
}


/* ============================================================
   CLEAN
   ============================================================ */

function clean(
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
  ).trim();
}


/* ============================================================
   JSON RESPONSE
   ============================================================ */

function json(
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
