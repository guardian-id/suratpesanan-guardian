import {
  PDFDocument,
  StandardFonts,
  rgb
} from "pdf-lib";

import { getDocument } from "pdfjs-serverless";

/* =========================================================
   GITHUB
   ========================================================= */

const GITHUB_BASE =
  "https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main";

const REGULER_URL =
  `${GITHUB_BASE}/Reguler.pdf`;

const PREKURSOR_URL =
  `${GITHUB_BASE}/Prekursor.pdf`;

const MASTER_URL =
  `${GITHUB_BASE}/master_prekursor.csv`;


/* =========================================================
   PLACEHOLDER
   ========================================================= */

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


/* =========================================================
   MAIN
   ========================================================= */

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


      /* =====================================================
         JSON POWER AUTOMATE
         ===================================================== */

      const body =
        await request.json();


      const templateName =
        String(
          body.template || ""
        )
          .trim()
          .toLowerCase();


      if (
        templateName !== "reguler" &&
        templateName !== "regular" &&
        templateName !== "prekursor"
      ) {

        throw new Error(
          `Template tidak dikenal: ${body.template}`
        );

      }


      /* =====================================================
         PDF UPLOAD WAJIB
         ===================================================== */

      const uploadedBase64 =
        body.pdfBase64 || "";


      if (!uploadedBase64) {

        throw new Error(
          "pdfBase64 wajib dikirim."
        );

      }


      const uploadedBytes =
        base64ToBytes(
          uploadedBase64
        );


      validatePdf(
        uploadedBytes,
        "pdfBase64"
      );


      /* =====================================================
         LOAD PDF UPLOAD
         ===================================================== */

      const uploadedPdf =
        await PDFDocument.load(
          uploadedBytes
        );


      const uploadPageCount =
        uploadedPdf.getPageCount();


      if (uploadPageCount < 1) {

        throw new Error(
          "PDF upload tidak mempunyai halaman."
        );

      }


      /* =====================================================
         DOWNLOAD TEMPLATE
         ===================================================== */

      const templateUrl =
        templateName === "prekursor"
          ? PREKURSOR_URL
          : REGULER_URL;


      const templateBytes =
        await downloadBytes(
          templateUrl
        );


      validatePdf(
        templateBytes,
        "Template PDF"
      );


      const templatePdf =
        await PDFDocument.load(
          templateBytes
        );


      const templatePageCount =
        templatePdf.getPageCount();


      /* =====================================================
         DATA SATU - DUABELAS
         ===================================================== */

      const data = {};


      for (const key of PLACEHOLDERS) {

        data[key] =
          body[key] === undefined ||
          body[key] === null
            ? ""
            : String(body[key]);

      }


      /* =====================================================
         PREKURSOR LOOKUP
         ===================================================== */

      let lookupInfo = null;


      if (
        templateName === "prekursor"
      ) {

        const uploadedText =
          await extractPdfText(
            uploadedBytes
          );


        const skuList =
          extractProductSKUs(
            uploadedText
          );


        if (
          skuList.length === 0
        ) {

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


        for (
          const sku of skuList
        ) {

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
            `SKU tidak ditemukan di master_prekursor.csv. SKU terbaca: ${skuList.join(", ")}`
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


        data.ZatAktif =
          zatAktif;


        data.Bentuk =
          bentuk;


        lookupInfo = {
          productSKU: foundSKU,
          zatAktif,
          bentuk
        };

      }


      /* =====================================================
         BUAT OUTPUT BARU
         
         JUMLAH HALAMAN = PDF UPLOAD
         ===================================================== */

      const outputPdf =
        await PDFDocument.create();


      /*
       * Embed semua template page.
       *
       * Jika template cuma 1 halaman,
       * halaman tersebut digunakan untuk semua halaman upload.
       */

      const templatePages = [];


      for (
        let i = 0;
        i < templatePageCount;
        i++
      ) {

        const copied =
          await outputPdf.copyPages(
            templatePdf,
            [i]
          );

        templatePages.push(
          copied[0]
        );

      }


      /* =====================================================
         FONT
         ===================================================== */

      const font =
        await outputPdf.embedFont(
          StandardFonts.Helvetica
        );


      /* =====================================================
         PDF.JS TEMPLATE
         
         Dipakai hanya untuk mencari:
         Satu
         Dua
         ...
         TTD
         Stempel
         ===================================================== */

      const templatePdfJs =
        await getPdfJs();


      const templateDocument =
        await templatePdfJs.getDocument({
          data:
            new Uint8Array(
              templateBytes
            ),
          useSystemFonts: true
        }).promise;


      /* =====================================================
         PREPARE TEMPLATE TEXT POSITION
         ===================================================== */

      const templateLocations = [];


      for (
        let pageNo = 1;
        pageNo <= templateDocument.numPages;
        pageNo++
      ) {

        const sourcePage =
          await templateDocument.getPage(
            pageNo
          );


        const content =
          await sourcePage.getTextContent();


        const items =
          content.items || [];


        templateLocations.push(
          {
            pageNo,
            items
          }
        );

      }


      /* =====================================================
         COPY TEMPLATE UNTUK SETIAP PAGE UPLOAD
         ===================================================== */

      const finalPages = [];


      for (
        let i = 0;
        i < uploadPageCount;
        i++
      ) {

        /*
         * Template page yang digunakan.
         *
         * Jika template 1 halaman:
         * gunakan page 1 untuk semuanya.
         *
         * Jika template >1 halaman:
         * gunakan template page sesuai nomor.
         */

        const templateIndex =
          Math.min(
            i,
            templatePages.length - 1
          );


        const page =
          templatePages[
            templateIndex
          ];


        finalPages.push(page);

      }


      /* =====================================================
         MASUKKAN PDF UPLOAD KE TEMPLATE
         
         INI YANG MEMPERTAHANKAN TABEL ASLI
         ===================================================== */

      for (
        let i = 0;
        i < uploadPageCount;
        i++
      ) {

        const sourcePage =
          uploadedPdf.getPages()[i];


        const targetPage =
          finalPages[i];


        /*
         * Ukuran halaman sumber
         */

        const sourceWidth =
          sourcePage.getWidth();


        const sourceHeight =
          sourcePage.getHeight();


        /*
         * Ukuran halaman template
         */

        const targetWidth =
          targetPage.getWidth();


        const targetHeight =
          targetPage.getHeight();


        /*
         * ==================================================
         * AREA TABEL
         *
         * Kalau PDF upload berisi tabel satu halaman penuh,
         * kita masukkan ke area tabel template.
         *
         * Angka ini sengaja dibuat mudah diubah.
         * ==================================================
         */

        const TABLE_X = 20;

        const TABLE_Y = 55;

        const TABLE_WIDTH =
          targetWidth - 40;

        const TABLE_HEIGHT =
          targetHeight - 125;


        /*
         * Rasio supaya tabel tidak gepeng.
         */

        const scaleX =
          TABLE_WIDTH /
          sourceWidth;


        const scaleY =
          TABLE_HEIGHT /
          sourceHeight;


        const scale =
          Math.min(
            scaleX,
            scaleY
          );


        const drawWidth =
          sourceWidth *
          scale;


        const drawHeight =
          sourceHeight *
          scale;


        const drawX =
          TABLE_X +
          (
            TABLE_WIDTH -
            drawWidth
          ) / 2;


        const drawY =
          TABLE_Y +
          (
            TABLE_HEIGHT -
            drawHeight
          ) / 2;


        /*
         * Embed halaman PDF upload.
         */

        const embeddedPage =
          await outputPdf.embedPage(
            sourcePage
          );


        /*
         * Gambar tabel PDF asli.
         */

        targetPage.drawPage(
          embeddedPage,
          {
            x: drawX,
            y: drawY,

            width: drawWidth,
            height: drawHeight
          }
        );

      }


      /* =====================================================
         REPLACE SATU - DUABELAS
         ===================================================== */

      for (
        let i = 0;
        i < uploadPageCount;
        i++
      ) {

        const templateIndex =
          Math.min(
            i,
            templateLocations.length - 1
          );


        const location =
          templateLocations[
            templateIndex
          ];


        const targetPage =
          finalPages[i];


        replaceTextOnPage(
          targetPage,
          location.items,
          data,
          font
        );

      }


      /* =====================================================
         TTD + STEMPEL
         ===================================================== */

      const ttdInput =
        body.ttdBase64 || "";


      const stampInput =
        body.stempelBase64 || "";


      if (
        ttdInput ||
        stampInput
      ) {

        await placeSignatureAndStamp(
          outputPdf,
          finalPages,
          templateLocations,
          ttdInput,
          stampInput
        );

      }


      /* =====================================================
         DESTROY PDF.JS
         ===================================================== */

      try {

        await templateDocument.destroy();

      } catch (_) {}


      /* =====================================================
         SAVE
         ===================================================== */

      const outputBytes =
        await outputPdf.save();


      const outputBase64 =
        bytesToBase64(
          outputBytes
        );


      /* =====================================================
         RESPONSE
         ===================================================== */

      const result = {

        success: true,

        message:
          "PDF berhasil diproses.",

        template:
          templateName === "prekursor"
            ? "Prekursor"
            : "Reguler",

        inputPages:
          uploadPageCount,

        outputPages:
          outputPdf.getPageCount(),

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


      return json(
        result
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


/* =========================================================
   REPLACE TEXT
   ========================================================= */

function replaceTextOnPage(
  page,
  items,
  data,
  font
) {

  /*
   * Kita proses placeholder satu kali saja.
   */

  const used = new Set();


  for (
    const key of PLACEHOLDERS
  ) {

    if (
      used.has(key)
    ) {
      continue;
    }


    const match =
      findBestTextMatch(
        items,
        key
      );


    if (!match) {
      continue;
    }


    used.add(key);


    const value =
      String(
        data[key] ?? ""
      );


    const t =
      match.transform || [];


    const x =
      Number(t[4] || 0);


    const baselineY =
      Number(t[5] || 0);


    const fontSize =
      Math.max(
        6,
        Math.abs(
          Number(
            t[3] || 10
          )
        )
      );


    const originalWidth =
      Math.max(
        Number(
          match.width || 0
        ),
        key.length *
        fontSize *
        0.45
      );


    /*
     * Tutup HANYA area placeholder.
     */

    page.drawRectangle({

      x:
        x - 2,

      y:
        baselineY -
        fontSize -
        3,

      width:
        originalWidth + 5,

      height:
        fontSize + 6,

      color:
        rgb(
          1,
          1,
          1
        ),

      opacity: 1

    });


    /*
     * Kalau kosong:
     * placeholder sudah dihapus.
     */

    if (
      value.trim() === ""
    ) {
      continue;
    }


    /*
     * Tulis pada baseline yang sama.
     */

    page.drawText(
      value,
      {

        x,

        y:
          baselineY -
          1,

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
          fontSize * 1.15

      }
    );

  }

}


/* =========================================================
   FIND TEXT
   ========================================================= */

function findBestTextMatch(
  items,
  target
) {

  /*
   * 1. Exact / contains dalam satu item.
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

      return {

        transform:
          item.transform,

        width:
          item.width || 0,

        text:
          item.str

      };

    }

  }


  /*
   * 2. Kalau PDF memecah kata.
   */

  for (
    let i = 0;
    i < items.length;
    i++
  ) {

    const first =
      items[i];


    if (
      !first ||
      typeof first.str !== "string"
    ) {
      continue;
    }


    let combined =
      "";


    let last =
      first;


    for (
      let j = i;
      j < Math.min(
        i + 8,
        items.length
      );
      j++
    ) {

      const item =
        items[j];


      if (
        !item ||
        typeof item.str !== "string"
      ) {
        continue;
      }


      combined +=
        item.str;


      last =
        item;


      if (
        combined.includes(
          target
        )
      ) {

        return {

          transform:
            first.transform,

          width:
            combinedWidth(
              first,
              last
            ),

          text:
            combined

        };

      }

    }

  }


  return null;

}


/* =========================================================
   COMBINED WIDTH
   ========================================================= */

function combinedWidth(
  first,
  last
) {

  const x1 =
    Number(
      first?.transform?.[4] || 0
    );


  const x2 =
    Number(
      last?.transform?.[4] || 0
    );


  return (
    Math.abs(
      x2 - x1
    ) +
    Number(
      last?.width || 0
    )
  );

}


/* =========================================================
   TTD + STEMPEL
   ========================================================= */

async function placeSignatureAndStamp(
  outputPdf,
  finalPages,
  templateLocations,
  ttdInput,
  stampInput
) {

  let ttdImage =
    null;


  let stampImage =
    null;


  /* =======================================================
     TTD
     ======================================================= */

  if (ttdInput) {

    const bytes =
      base64ToBytes(
        extractImageBase64(
          ttdInput
        )
      );


    if (
      isJpg(bytes)
    ) {

      ttdImage =
        await outputPdf.embedJpg(
          bytes
        );

    } else {

      ttdImage =
        await outputPdf.embedPng(
          bytes
        );

    }

  }


  /* =======================================================
     STEMPEL
     ======================================================= */

  if (stampInput) {

    const bytes =
      base64ToBytes(
        extractImageBase64(
          stampInput
        )
      );


    if (
      isJpg(bytes)
    ) {

      stampImage =
        await outputPdf.embedJpg(
          bytes
        );

    } else {

      stampImage =
        await outputPdf.embedPng(
          bytes
        );

    }

  }


  /* =======================================================
     SETIAP HALAMAN
     ======================================================= */

  for (
    let i = 0;
    i < finalPages.length;
    i++
  ) {

    const page =
      finalPages[i];


    const locationIndex =
      Math.min(
        i,
        templateLocations.length - 1
      );


    const items =
      templateLocations[
        locationIndex
      ]?.items || [];


    /* =====================================================
       TTD
       ===================================================== */

    if (ttdImage) {

      const match =
        findBestTextMatch(
          items,
          "TTD"
        );


      if (match) {

        const x =
          Number(
            match.transform?.[4] || 0
          );


        const y =
          Number(
            match.transform?.[5] || 0
          );


        /*
         * Hapus keyword.
         */

        page.drawRectangle({

          x:
            x - 5,

          y:
            y - 15,

          width:
            Math.max(
              Number(
                match.width || 30
              ),
              30
            ) + 10,

          height:
            25,

          color:
            rgb(
              1,
              1,
              1
            )

        });


        /*
         * TTD.
         */

        page.drawImage(
          ttdImage,
          {

            x:
              x - 10,

            y:
              y + 2,

            width:
              105,

            height:
              55

          }
        );

      }

    }


    /* =====================================================
       STEMPEL
       ===================================================== */

    if (stampImage) {

      const match =
        findBestTextMatch(
          items,
          "Stempel"
        );


      if (match) {

        const x =
          Number(
            match.transform?.[4] || 0
          );


        const y =
          Number(
            match.transform?.[5] || 0
          );


        /*
         * Hapus keyword.
         */

        page.drawRectangle({

          x:
            x - 5,

          y:
            y - 15,

          width:
            Math.max(
              Number(
                match.width || 50
              ),
              50
            ) + 10,

          height:
            25,

          color:
            rgb(
              1,
              1,
              1
            )

        });


        /*
         * Stempel.
         */

        page.drawImage(
          stampImage,
          {

            x:
              x - 5,

            y:
              y - 42,

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

}


/* =========================================================
   EXTRACT PDF TEXT
   ========================================================= */

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

      useSystemFonts:
        true

    }).promise;


  const pages = [];


  for (
    let i = 1;
    i <= document.numPages;
    i++
  ) {

    const page =
      await document.getPage(
        i
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


/* =========================================================
   PDF.JS
   ========================================================= */

let pdfJsPromise =
  null;


async function getPdfJs() {

  if (!pdfJsPromise) {

    pdfJsPromise =
      import(
        "pdfjs-serverless"
      );

  }


  return pdfJsPromise;

}


/* =========================================================
   SKU
   ========================================================= */

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
          String(
            x
          ).trim()
      )
    )
  ];

}


/* =========================================================
   CSV
   ========================================================= */

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
      .split(
        /\r?\n/
      )
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


/* =========================================================
   CSV LINE
   ========================================================= */

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


/* =========================================================
   FIND SKU
   ========================================================= */

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


/* =========================================================
   NORMALIZE SKU
   ========================================================= */

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


/* =========================================================
   FIRST VALUE
   ========================================================= */

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


/* =========================================================
   DOWNLOAD BYTES
   ========================================================= */

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


/* =========================================================
   DOWNLOAD TEXT
   ========================================================= */

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


/* =========================================================
   BASE64 → BYTES
   ========================================================= */

function base64ToBytes(
  input
) {

  let value =
    String(
      input || ""
    ).trim();


  /*
   * DATA URI
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
      atob(
        value
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


/* =========================================================
   IMAGE BASE64
   ========================================================= */

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


/* =========================================================
   BYTES → BASE64
   ========================================================= */

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


/* =========================================================
   VALIDATE PDF
   ========================================================= */

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


/* =========================================================
   JPG
   ========================================================= */

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


/* =========================================================
   JSON RESPONSE
   ========================================================= */

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
