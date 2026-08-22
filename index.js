import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

/* =========================================================
   GITHUB
   ========================================================= */

const GITHUB_BASE =
  "https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main";;

const REGULER_URL =
  `${GITHUB_BASE}/Reguler.pdf`;

const PREKURSOR_URL =
  `${GITHUB_BASE}/Prekursor.pdf`;

const MASTER_URL =
  `${GITHUB_BASE}/master_prekursor.csv`;


/* =========================================================
   WORKER
   ========================================================= */

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


      /* =====================================================
         INPUT
         ===================================================== */

      const template =
        String(body.template || "")
          .trim()
          .toLowerCase();


      if (!template) {
        throw new Error(
          "template wajib dikirim."
        );
      }


      const ttdBase64 =
        body.ttdBase64 || "";


      const stempelBase64 =
        body.stempelBase64 || "";


      /* =====================================================
         PILIH TEMPLATE
         ===================================================== */

      let templateUrl;

      if (
        template === "reguler" ||
        template === "regular"
      ) {

        templateUrl =
          REGULER_URL;

      } else if (
        template === "prekursor"
      ) {

        templateUrl =
          PREKURSOR_URL;

      } else {

        throw new Error(
          `Template tidak dikenal: ${body.template}`
        );
      }


      /* =====================================================
         DOWNLOAD TEMPLATE PDF
         ===================================================== */

      const templateBytes =
        await downloadBytes(
          templateUrl
        );


      /* =====================================================
         LOAD PDF
         ===================================================== */

      const pdf =
        await PDFDocument.load(
          templateBytes
        );


      /* =====================================================
         DATA POWER AUTOMATE
         ===================================================== */

      const data = {

        Satu:
          body.Satu,

        Dua:
          body.Dua,

        Tiga:
          body.Tiga,

        Empat:
          body.Empat,

        Lima:
          body.Lima,

        Enam:
          body.Enam,

        Tujuh:
          body.Tujuh,

        Delapan:
          body.Delapan,

        Sembilan:
          body.Sembilan,

        Sepuluh:
          body.Sepuluh,

        Sebelas:
          body.Sebelas,

        Duabelas:
          body.Duabelas
      };


      /* =====================================================
         PREKURSOR
         ===================================================== */

      if (
        template === "prekursor"
      ) {

        const masterCsv =
          await downloadText(
            MASTER_URL
          );


        const master =
          parseCSV(
            masterCsv
          );


        /*
         * Cari semua Product SKU dari JSON
         */

        const skuList =
          extractSKUs(
            body
          );


        /*
         * Kalau hanya satu SKU,
         * ambil satu data.
         */

        if (skuList.length > 0) {

          const sku =
            skuList[0];


          const found =
            findSKU(
              master,
              sku
            );


          if (found) {

            data.ZatAktif =
              firstValue(
                found,
                [
                  "Zat Aktif",
                  "ZatAktif",
                  "ZAT AKTIF"
                ]
              );


            data.Bentuk =
              firstValue(
                found,
                [
                  "Bentuk",
                  "BENTUK"
                ]
              );

          } else {

            data.ZatAktif = "";
            data.Bentuk = "";
          }

        } else {

          data.ZatAktif = "";
          data.Bentuk = "";
        }
      }


      /* =====================================================
         REPLACE TEXT DI PDF
         ===================================================== */

      await replacePDFPlaceholders(
        pdf,
        templateBytes,
        data
      );


      /* =====================================================
         TTD + STEMPEL
         ===================================================== */

      await addTTDAndStamp(
        pdf,
        ttdBase64,
        stempelBase64
      );


      /* =====================================================
         SAVE
         ===================================================== */

      const output =
        await pdf.save();


      const outputBase64 =
        bytesToBase64(
          output
        );


      const fileName =
        template === "prekursor"
          ? "Prekursor.pdf"
          : "Reguler.pdf";


      return json({

        success: true,

        fileName,

        contentType:
          "application/pdf",

        spBase64:
          outputBase64
      });


    } catch (error) {

      return json({

        success: false,

        message:
          error?.message ||
          "Terjadi error.",

        stack:
          error?.stack || ""

      }, 500);
    }
  }
};


/* =========================================================
   REPLACE PDF PLACEHOLDERS
   ========================================================= */

async function replacePDFPlaceholders(
  pdf,
  originalBytes,
  data
) {

  /*
   * pdfjs membaca PDF asli untuk mendapatkan
   * posisi teks placeholder.
   */

  const loadingTask =
    pdfjsLib.getDocument({
      data:
        originalBytes.slice()
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


    const pdfPage =
      pages[pageIndex];


    if (!pdfPage) {
      continue;
    }


    /*
     * Gabungkan item text agar placeholder
     * tetap bisa ditemukan walaupun PDF
     * memecah text menjadi beberapa item.
     */

    const items =
      content.items || [];


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
        String(rawValue);


      if (value === "") {
        continue;
      }


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

        /*
         * Transform PDF.js:
         *
         * [scaleX, skewY, skewX, scaleY, x, y]
         */

        const transform =
          match.transform;


        const x =
          transform[4];


        const pdfPageHeight =
          pdfPage.getHeight();


        /*
         * PDF.js menggunakan origin
         * di kiri bawah untuk text transform,
         * sehingga y perlu disesuaikan
         * dengan tinggi font.
         */

        const fontSize =
          Math.abs(
            transform[3]
          ) || 10;


        const y =
          transform[5] -
          fontSize;


        /*
         * Lebar placeholder.
         */

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
         * Tutup placeholder lama.
         */

        pdfPage.drawRectangle({

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

          opacity:
            1,

          borderWidth:
            0
        });


        /*
         * Tulis data baru.
         */

        pdfPage.drawText(
          value,
          {

            x:
              x,

            y:
              y,

            size:
              fontSize,

            font,

            color:
              rgb(0, 0, 0),

            maxWidth:
              Math.max(
                placeholderWidth + 50,
                100
              ),

            lineHeight:
              fontSize * 1.2
          }
        );
      }
    }
  }
}


/* =========================================================
   FIND TEXT
   ========================================================= */

function findTextMatches(
  items,
  target
) {

  const result = [];


  /*
   * 1. Exact item
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
          item.width ||
          0,

        str:
          item.str
      });
    }
  }


  /*
   * 2. Placeholder yang terpecah
   *
   * Contoh:
   *
   * "Sa"
   * "tu"
   *
   * menjadi "Satu"
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


      last = item;


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


  return result;
}


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


/* =========================================================
   TTD + STEMPEL
   ========================================================= */

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


  if (ttdBase64) {

    const bytes =
      base64ToBytes(
        ttdBase64
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


  if (stempelBase64) {

    const bytes =
      base64ToBytes(
        stempelBase64
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


  const pages =
    pdf.getPages();


  /*
   * Posisi TTD + stempel
   *
   * Ini mempertahankan konsep yang
   * sudah kita pakai sebelumnya:
   * satu blok di area tanda tangan.
   */

  for (
    const page of pages
  ) {

    const {
      width
    } =
      page.getSize();


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


/* =========================================================
   SKU
   ========================================================= */

function extractSKUs(
  body
) {

  const result = [];


  const direct = [
    body["Product SKU"],
    body["ProductSKU"],
    body["SKU"],
    body["Sku"],
    body["sku"]
  ];


  for (
    const value of direct
  ) {

    if (
      value !== undefined &&
      value !== null &&
      String(value).trim()
    ) {

      result.push(
        String(value).trim()
      );
    }
  }


  const fields = [
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


  for (
    const field of fields
  ) {

    const value =
      body[field];


    if (
      typeof value === "object" &&
      value !== null
    ) {

      addObjectSKU(
        result,
        value
      );
    }


    if (
      typeof value === "string"
    ) {

      try {

        const parsed =
          JSON.parse(value);


        if (
          parsed &&
          typeof parsed === "object"
        ) {

          if (Array.isArray(parsed)) {

            for (
              const row of parsed
            ) {

              addObjectSKU(
                result,
                row
              );
            }

          } else {

            addObjectSKU(
              result,
              parsed
            );
          }
        }

      } catch (_) {}
    }
  }


  return [
    ...new Set(result)
  ];
}


function addObjectSKU(
  result,
  object
) {

  const sku =
    object["Product SKU"] ??
    object["ProductSKU"] ??
    object["SKU"] ??
    object["Sku"] ??
    object["sku"];


  if (
    sku !== undefined &&
    sku !== null &&
    String(sku).trim()
  ) {

    result.push(
      String(sku).trim()
    );
  }
}


/* =========================================================
   CSV
   ========================================================= */

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
        x =>
          x.trim() !== ""
      );


  if (!lines.length) {
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

    const c =
      line[i];


    if (c === '"') {

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
      c === "," &&
      !quoted
    ) {

      result.push(
        current.trim()
      );

      current = "";

    } else {

      current += c;
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
    normalizeSKU(sku);


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
          normalizeSKU(value) === target
      );
    }
  ) || null;
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


  return String(value)
    .trim()
    .replace(/^0+/, "")
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


/* =========================================================
   DOWNLOAD
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
            "Cloudflare-PDF-Worker"
        }
      }
    );


  if (!response.ok) {

    throw new Error(
      `Gagal mengambil ${url} (${response.status})`
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
            "Cloudflare-PDF-Worker"
        }
      }
    );


  if (!response.ok) {

    throw new Error(
      `Gagal mengambil ${url} (${response.status})`
    );
  }


  return response.text();
}


/* =========================================================
   IMAGE / BASE64
   ========================================================= */

function base64ToBytes(
  value
) {

  let text =
    String(value || "")
      .trim();


  if (
    text.startsWith("data:")
  ) {

    text =
      text.substring(
        text.indexOf(",") + 1
      );
  }


  text =
    text.replace(
      /\s/g,
      ""
    );


  const binary =
    atob(text);


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


function isJPG(
  bytes
) {

  return (
    bytes[0] === 0xFF &&
    bytes[1] === 0xD8 &&
    bytes[2] === 0xFF
  );
}


function bytesToBase64(
  bytes
) {

  let binary = "";

  const chunk =
    0x8000;


  for (
    let i = 0;
    i < bytes.length;
    i += chunk
  ) {

    binary +=
      String.fromCharCode(
        ...bytes.subarray(
          i,
          Math.min(
            i + chunk,
            bytes.length
          )
        )
      );
  }


  return btoa(binary);
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
