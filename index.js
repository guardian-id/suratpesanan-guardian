import {
  PDFDocument,
  StandardFonts,
  rgb
} from "pdf-lib";

import {
  getDocument
} from "pdfjs-serverless";


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

        return json(
          {
            success: false,
            message: "Method harus POST."
          },
          405
        );
      }


      const body =
        await request.json();


      /* ======================================================
         TEMPLATE
         ====================================================== */

      const template =
        String(
          body.template || ""
        )
        .trim()
        .toLowerCase();


      if (!template) {

        throw new Error(
          "template wajib dikirim."
        );
      }


      const isPrekursor =
        template === "prekursor";


      const isReguler =
        template === "reguler" ||
        template === "regular";


      if (
        !isPrekursor &&
        !isReguler
      ) {

        throw new Error(
          `Template tidak dikenal: ${body.template}`
        );
      }


      /* ======================================================
         PDF BASE64 DARI POWER AUTOMATE
         
         DIGUNAKAN SEBAGAI SUMBER DATA.
         ====================================================== */

      const pdfBase64 =
        body.pdfBase64 || "";


      if (!pdfBase64) {

        throw new Error(
          "pdfBase64 wajib dikirim."
        );
      }


      const sourcePdfBytes =
        base64ToBytes(
          pdfBase64
        );


      validatePDF(
        sourcePdfBytes,
        "pdfBase64"
      );


      /* ======================================================
         BACA PDF SUMBER
         
         Khususnya diperlukan untuk Prekursor
         untuk mencari Product SKU.
         ====================================================== */

      const sourceText =
        await extractPDFText(
          sourcePdfBytes
        );


      /* ======================================================
         AMBIL TEMPLATE DARI GITHUB
         ====================================================== */

      let templateURL =
        REGULER_URL;


      if (isPrekursor) {
        templateURL =
          PREKURSOR_URL;
      }


      const templateBytes =
        await downloadBytes(
          templateURL
        );


      validatePDF(
        templateBytes,
        "Template GitHub"
      );


      /* ======================================================
         LOAD TEMPLATE
         ====================================================== */

      const pdf =
        await PDFDocument.load(
          templateBytes
        );


      /* ======================================================
         DATA Satu - Duabelas
         ====================================================== */

      const replacements = {

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
         PREKURSOR LOOKUP
         ====================================================== */

      let productSKU = "";
      let zatAktif = "";
      let bentuk = "";


      if (isPrekursor) {

        const skuList =
          extractSKUsFromText(
            sourceText
          );


        if (
          skuList.length === 0
        ) {

          throw new Error(
            "Product SKU tidak ditemukan pada PDF upload."
          );
        }


        /* ----------------------------------------------------
           MASTER CSV
           ---------------------------------------------------- */

        const masterCSV =
          await downloadText(
            MASTER_URL
          );


        const masterRows =
          parseCSV(
            masterCSV
          );


        /* ----------------------------------------------------
           LOOKUP SKU
           ---------------------------------------------------- */

        let found = null;


        for (
          const sku of skuList
        ) {

          found =
            findSKU(
              masterRows,
              sku
            );


          if (found) {

            productSKU =
              sku;

            break;
          }
        }


        if (!found) {

          throw new Error(
            `Product SKU tidak ditemukan di master_prekursor.csv. SKU PDF: ${skuList.join(", ")}`
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


        /*
         * Kalau template Prekursor mempunyai
         * placeholder ZatAktif dan Bentuk,
         * keduanya ikut diganti.
         */

        replacements.ZatAktif =
          zatAktif;

        replacements.Bentuk =
          bentuk;
      }


      /* ======================================================
         REPLACE TEXT BIASA
         ====================================================== */

      await replaceTemplateText(
        pdf,
        templateBytes,
        replacements
      );


      /* ======================================================
         TTD + STEMPEL
         ====================================================== */

      await placeTTDAndStamp(
        pdf,
        templateBytes,
        body.ttdBase64 || "",
        body.stempelBase64 || ""
      );


      /* ======================================================
         SAVE
         ====================================================== */

      const outputBytes =
        await pdf.save();


      const outputBase64 =
        bytesToBase64(
          outputBytes
        );


      /* ======================================================
         RESPONSE
         ====================================================== */

      const response = {

        success: true,

        fileName:
          isPrekursor
            ? "Prekursor.pdf"
            : "Reguler.pdf",

        contentType:
          "application/pdf",

        pages:
          pdf.getPageCount(),

        spBase64:
          outputBase64
      };


      if (isPrekursor) {

        response.productSKU =
          productSKU;

        response.zatAktif =
          zatAktif;

        response.bentuk =
          bentuk;
      }


      return json(
        response
      );


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


/* ============================================================
   EXTRACT PDF TEXT
   ============================================================ */

async function extractPDFText(
  pdfBytes
) {

  const loadingTask =
    getDocument(
      {
        data:
          new Uint8Array(
            pdfBytes
          ),

        useSystemFonts:
          true
      }
    );


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
          item => {

            if (
              typeof item.str === "string"
            ) {

              return item.str;
            }

            return "";
          }
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
   REPLACE TEMPLATE TEXT
   ============================================================ */

async function replaceTemplateText(
  pdf,
  templateBytes,
  replacements
) {

  const loadingTask =
    getDocument(
      {
        data:
          new Uint8Array(
            templateBytes
          ),

        useSystemFonts:
          true
      }
    );


  const sourceDocument =
    await loadingTask.promise;


  const font =
    await pdf.embedFont(
      StandardFonts.Helvetica
    );


  const pages =
    pdf.getPages();


  for (
    let pageIndex = 0;
    pageIndex < sourceDocument.numPages;
    pageIndex++
  ) {

    const sourcePage =
      await sourceDocument.getPage(
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
      const placeholder of Object.keys(
        replacements
      )
    ) {

      const value =
        replacements[
          placeholder
        ];


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


        if (!transform) {
          continue;
        }


        const x =
          transform[4];


        const yBase =
          transform[5];


        const fontSize =
          Math.max(
            6,
            Math.abs(
              transform[3]
            ) || 10
          );


        const y =
          yBase -
          fontSize;


        const oldWidth =
          Math.max(
            match.width || 0,
            placeholder.length *
            fontSize *
            0.5
          );


        const boxHeight =
          fontSize *
          1.5;


        /*
         * Tutup teks lama
         */

        targetPage.drawRectangle(
          {

            x:
              x - 1,

            y:
              y - 2,

            width:
              oldWidth + 5,

            height:
              boxHeight + 4,

            color:
              rgb(
                1,
                1,
                1
              ),

            opacity:
              1
          }
        );


        /*
         * Jika value kosong,
         * placeholder dihapus saja.
         */

        if (
          value === ""
        ) {
          continue;
        }


        /*
         * Tulis value baru
         */

        targetPage.drawText(
          String(value),
          {

            x,

            y,

            size:
              fontSize,

            font,

            color:
              rgb(
                0,
                0,
                0
              ),

            lineHeight:
              fontSize *
              1.2
          }
        );
      }
    }
  }


  try {

    await sourceDocument.destroy();

  } catch (_) {}
}


/* ============================================================
   FIND TEXT
   ============================================================ */

function findTextMatches(
  items,
  target
) {

  const matches = [];


  /*
   * CASE 1
   * Text berada dalam satu item.
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

      matches.push(
        {
          transform:
            item.transform,

          width:
            item.width || 0,

          str:
            item.str
        }
      );
    }
  }


  /*
   * CASE 2
   * Text terpecah menjadi beberapa item.
   *
   * Contoh:
   *
   * Sa + tu
   */

  for (
    let i = 0;
    i < items.length;
    i++
  ) {

    let combined =
      "";

    let first =
      null;

    let last =
      null;


    for (
      let j = i;
      j < Math.min(
        i + 10,
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

        matches.push(
          {
            transform:
              first.transform,

            width:
              calculateCombinedWidth(
                first,
                last
              ),

            str:
              combined
          }
        );


        break;
      }
    }
  }


  return removeDuplicateMatches(
    matches
  );
}


/* ============================================================
   REMOVE DUPLICATE
   ============================================================ */

function removeDuplicateMatches(
  matches
) {

  const result = [];

  const seen =
    new Set();


  for (
    const match of matches
  ) {

    const transform =
      match.transform || [];


    const key =
      [
        transform[4],
        transform[5],
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
   COMBINED WIDTH
   ============================================================ */

function calculateCombinedWidth(
  first,
  last
) {

  if (
    !first ||
    !last
  ) {

    return 0;
  }


  const firstX =
    first.transform?.[4] || 0;


  const lastX =
    last.transform?.[4] || 0;


  return Math.abs(
    lastX -
    firstX
  ) +
  (
    last.width ||
    0
  );
}


/* ============================================================
   EXTRACT PRODUCT SKU
   ============================================================ */

function extractSKUsFromText(
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


  return [
    ...new Set(
      result
        .map(
          value =>
            String(value)
              .trim()
        )
        .filter(Boolean)
    )
  ];
}


/* ============================================================
   FIND SKU
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

      const candidates = [

        row["Product SKU"],

        row["ProductSKU"],

        row["SKU"],

        row["Sku"],

        row["sku"]

      ];


      return candidates.some(
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


  return String(value)
    .trim()
    .replace(
      /^0+/,
      ""
    )
    .toUpperCase();
}


/* ============================================================
   TTD + STEMPEL
   ============================================================ */

async function placeTTDAndStamp(
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


  const ttdBytes =
    ttdInput
      ? base64ToBytes(
          extractImageBase64(
            ttdInput
          )
        )
      : null;


  const stampBytes =
    stampInput
      ? base64ToBytes(
          extractImageBase64(
            stampInput
          )
        )
      : null;


  let ttdImage =
    null;


  let stampImage =
    null;


  if (ttdBytes) {

    validateImage(
      ttdBytes,
      "ttdBase64"
    );


    if (
      isJPG(ttdBytes)
    ) {

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


  if (stampBytes) {

    validateImage(
      stampBytes,
      "stempelBase64"
    );


    if (
      isJPG(stampBytes)
    ) {

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


  /*
   * Baca keyword TTD dan Stempel
   * dari template GitHub.
   */

  const loadingTask =
    getDocument(
      {
        data:
          new Uint8Array(
            templateBytes
          ),

        useSystemFonts:
          true
      }
    );


  const sourceDocument =
    await loadingTask.promise;


  const pages =
    pdf.getPages();


  for (
    let pageIndex = 0;
    pageIndex < sourceDocument.numPages;
    pageIndex++
  ) {

    const sourcePage =
      await sourceDocument.getPage(
        pageIndex + 1
      );


    const content =
      await sourcePage.getTextContent();


    const items =
      content.items || [];


    const page =
      pages[pageIndex];


    if (!page) {
      continue;
    }


    /*
     * Cari TTD
     */

    const ttdMatches =
      findTextMatches(
        items,
        "TTD"
      );


    /*
     * Cari Stempel
     */

    const stampMatches =
      findTextMatches(
        items,
        "Stempel"
      );


    /*
     * TTD
     */

    if (
      ttdImage &&
      ttdMatches.length > 0
    ) {

      const match =
        ttdMatches[0];


      const x =
        match.transform[4];


      const y =
        match.transform[5];


      const width =
        105;


      const height =
        55;


      /*
       * Tutup keyword TTD
       */

      page.drawRectangle(
        {

          x:
            x - 2,

          y:
            y - 10,

          width:
            Math.max(
              match.width || 25,
              25
            ) + 4,

          height:
            20,

          color:
            rgb(
              1,
              1,
              1
            )
        }
      );


      /*
       * TTD sedikit di atas
       */

      page.drawImage(
        ttdImage,
        {

          x:
            x - 20,

          y:
            y + 8,

          width,

          height
        }
      );
    }


    /*
     * STEMPEL
     */

    if (
      stampImage &&
      stampMatches.length > 0
    ) {

      const match =
        stampMatches[0];


      const x =
        match.transform[4];


      const y =
        match.transform[5];


      const width =
        85;


      const height =
        85;


      /*
       * Tutup keyword Stempel
       */

      page.drawRectangle(
        {

          x:
            x - 2,

          y:
            y - 10,

          width:
            Math.max(
              match.width || 50,
              50
            ) + 4,

          height:
            20,

          color:
            rgb(
              1,
              1,
              1
            )
        }
      );


      /*
       * Stempel sedikit di bawah TTD
       */

      page.drawImage(
        stampImage,
        {

          x:
            x - 5,

          y:
            y - 50,

          width,

          height,

          opacity:
            0.85
        }
      );
    }
  }


  try {

    await sourceDocument.destroy();

  } catch (_) {}
}


/* ============================================================
   EXTRACT IMAGE BASE64
   ============================================================ */

function extractImageBase64(
  input
) {

  let value =
    String(
      input || ""
    ).trim();


  /*
   * Format:
   *
   * <img src="data:image/png;base64,AAAA...">
   */

  const imgMatch =
    value.match(
      /<img[^>]+src=["']data:image\/(?:png|jpeg|jpg);base64,([^"']+)["']/i
    );


  if (
    imgMatch &&
    imgMatch[1]
  ) {

    return imgMatch[1];
  }


  /*
   * Format data URI langsung.
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

      return value.substring(
        comma + 1
      );
    }
  }


  return value
    .replace(
      /\s/g,
      ""
    );
}


/* ============================================================
   CSV PARSER
   ============================================================ */

function parseCSV(
  text
) {

  const cleanText =
    String(
      text || ""
    )
    .replace(
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

  let current =
    "";

  let quoted =
    false;


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

        current +=
          '"';

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

      current =
        "";

    } else {

      current +=
        char;
    }
  }


  result.push(
    current.trim()
  );


  return result;
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
    )
    .trim();


  if (
    text.startsWith(
      "data:"
    )
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


  if (!text) {

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

  let binary =
    "";

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
      `Gagal mengambil template: HTTP ${response.status}`
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
      `Gagal mengambil master CSV: HTTP ${response.status}`
    );
  }


  return await response.text();
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
   IMAGE VALIDATION
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
    isJPG(
      bytes
    );


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
   JPG
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
   FIRST VALUE
   ============================================================ */

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
   JSON
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
