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
   CLOUDFLARE WORKER
   ============================================================ */

export default {

  async fetch(request) {

    try {

      /* ------------------------------------------------------
         METHOD
         ------------------------------------------------------ */

      if (request.method !== "POST") {

        return jsonResponse({
          success: false,
          message: "Method harus POST."
        }, 405);
      }


      /* ------------------------------------------------------
         JSON POWER AUTOMATE
         ------------------------------------------------------ */

      const body =
        await request.json();


      const template =
        String(body.template || "")
          .trim()
          .toLowerCase();


      if (!template) {

        throw new Error(
          "Parameter 'template' wajib dikirim."
        );
      }


      /* ------------------------------------------------------
         PILIH TEMPLATE GITHUB
         ------------------------------------------------------ */

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


      /* ------------------------------------------------------
         AMBIL TEMPLATE PDF
         ------------------------------------------------------ */

      const templateBytes =
        await downloadBinary(
          templateURL
        );


      /* ------------------------------------------------------
         LOAD PDF
         ------------------------------------------------------ */

      const pdf =
        await PDFDocument.load(
          templateBytes
        );


      /* ======================================================
         DATA DARI POWER AUTOMATE
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
         PREKURSOR
         ====================================================== */

      if (template === "prekursor") {

        const csvText =
          await downloadText(
            MASTER_URL
          );


        const master =
          parseCSV(
            csvText
          );


        /*
         * Cari Product SKU dari JSON
         */

        const sku =
          findProductSKU(
            body
          );


        if (sku) {

          const result =
            lookupSKU(
              master,
              sku
            );


          if (result) {

            data.ZatAktif =
              getValue(
                result,
                [
                  "Zat Aktif",
                  "ZatAktif",
                  "ZAT AKTIF"
                ]
              );


            data.Bentuk =
              getValue(
                result,
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


      /* ======================================================
         ISI PDF
         ====================================================== */

      await replacePDFText(
        pdf,
        templateBytes,
        data
      );


      /* ======================================================
         TTD + STEMPEL
         ====================================================== */

      await addTTDAndStamp(
        pdf,
        body.ttdBase64,
        body.stempelBase64
      );


      /* ======================================================
         SAVE
         ====================================================== */

      const finalBytes =
        await pdf.save();


      const finalBase64 =
        bytesToBase64(
          finalBytes
        );


      /* ======================================================
         FILE NAME
         ====================================================== */

      const fileName =
        template === "prekursor"
          ? "Prekursor.pdf"
          : "Reguler.pdf";


      /* ======================================================
         RESPONSE
         ====================================================== */

      return jsonResponse({

        success: true,

        fileName,

        contentType:
          "application/pdf",

        spBase64:
          finalBase64

      });


    } catch (error) {

      return jsonResponse({

        success: false,

        message:
          error?.message ||
          "Terjadi error pada Worker.",

        stack:
          error?.stack ||
          null

      }, 500);
    }
  }
};


/* ============================================================
   REPLACE TEXT PDF
   ============================================================ */

async function replacePDFText(
  pdf,
  originalBytes,
  data
) {

  /*
   * PDF.js membaca text layer dari template.
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


  const pages =
    pdf.getPages();


  const font =
    await pdf.embedFont(
      StandardFonts.Helvetica
    );


  /*
   * Cari placeholder satu per satu.
   */

  for (
    let pageIndex = 0;
    pageIndex < sourcePdf.numPages;
    pageIndex++
  ) {

    const sourcePage =
      await sourcePdf.getPage(
        pageIndex + 1
      );


    const textContent =
      await sourcePage.getTextContent();


    const items =
      textContent.items || [];


    const targetPage =
      pages[pageIndex];


    if (!targetPage) {
      continue;
    }


    for (
      const [placeholder, value]
      of Object.entries(data)
    ) {

      if (
        value === undefined ||
        value === null
      ) {
        continue;
      }


      const replacement =
        String(value);


      /*
       * Kalau kosong, tetap tutup placeholder.
       */

      const matches =
        findPlaceholder(
          items,
          placeholder
        );


      for (
        const match
        of matches
      ) {

        const transform =
          match.transform;


        /*
         * PDF.js transform:
         *
         * [a, b, c, d, x, y]
         */

        const x =
          transform[4];


        const y =
          transform[5];


        const fontSize =
          Math.max(
            6,
            Math.abs(
              transform[3]
            ) || 10
          );


        const oldWidth =
          Math.max(
            match.width || 0,
            placeholder.length *
            fontSize *
            0.5
          );


        const boxHeight =
          fontSize * 1.4;


        /*
         * Tutup placeholder lama.
         */

        targetPage.drawRectangle({

          x:
            x - 2,

          y:
            y - fontSize * 0.35,

          width:
            oldWidth + 4,

          height:
            boxHeight + 4,

          color:
            rgb(1, 1, 1),

          borderWidth:
            0
        });


        /*
         * Jika replacement kosong,
         * cukup hapus placeholder.
         */

        if (
          replacement === ""
        ) {
          continue;
        }


        /*
         * Tulis nilai baru.
         */

        targetPage.drawText(
          replacement,
          {

            x:
              x,

            y:
              y - fontSize * 0.25,

            size:
              fontSize,

            font,

            color:
              rgb(0, 0, 0),

            maxWidth:
              Math.max(
                oldWidth + 100,
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


/* ============================================================
   FIND PLACEHOLDER
   ============================================================ */

function findPlaceholder(
  items,
  target
) {

  const result = [];


  /*
   * CASE 1
   *
   * Placeholder utuh berada dalam satu
   * text item.
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

        text:
          item.str

      });
    }
  }


  /*
   * CASE 2
   *
   * Placeholder terpecah menjadi
   * beberapa text item.
   *
   * Contoh:
   *
   * "Sa" + "tu"
   */

  for (
    let start = 0;
    start < items.length;
    start++
  ) {

    let combined = "";

    let first = null;

    let last = null;


    for (
      let i = start;
      i < Math.min(
        start + 12,
        items.length
      );
      i++
    ) {

      const item =
        items[i];


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


  return result;
}


/* ============================================================
   COMBINED WIDTH
   ============================================================ */

function combinedWidth(
  first,
  last
) {

  const firstX =
    first.transform[4];


  const lastX =
    last.transform[4];


  return Math.abs(
    lastX - firstX
  ) +
  (last.width || 0);
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


  let ttdImage = null;

  let stampImage = null;


  /* ----------------------------------------------------------
     TTD
     ---------------------------------------------------------- */

  if (ttdBase64) {

    const bytes =
      base64ToBytes(
        ttdBase64
      );


    if (
      isJPG(bytes)
    ) {

      ttdImage =
        await pdf.embedJpg(
          bytes
        );

    } else {

      ttdImage =
        await pdf.embedPng(
          bytes
        );
    }
  }


  /* ----------------------------------------------------------
     STEMPEL
     ---------------------------------------------------------- */

  if (stempelBase64) {

    const bytes =
      base64ToBytes(
        stempelBase64
      );


    if (
      isJPG(bytes)
    ) {

      stampImage =
        await pdf.embedJpg(
          bytes
        );

    } else {

      stampImage =
        await pdf.embedPng(
          bytes
        );
    }
  }


  /* ----------------------------------------------------------
     SETIAP HALAMAN
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

    if (stampImage) {

      page.drawImage(
        stampImage,
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

    if (ttdImage) {

      page.drawImage(
        ttdImage,
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
   PRODUCT SKU
   ============================================================ */

function findProductSKU(
  body
) {

  /*
   * Cek langsung
   */

  const direct = [

    body["Product SKU"],
    body["ProductSKU"],
    body["SKU"],
    body["Sku"],
    body["sku"]

  ];


  for (
    const value
    of direct
  ) {

    if (
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ""
    ) {

      return String(
        value
      ).trim();
    }
  }


  /*
   * Cek Satu-Duabelas
   */

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
    const fieldName
    of fields
  ) {

    const value =
      body[fieldName];


    /*
     * Object
     */

    if (
      value &&
      typeof value === "object"
    ) {

      const sku =
        getObjectSKU(
          value
        );


      if (sku) {
        return sku;
      }
    }


    /*
     * JSON string
     */

    if (
      typeof value === "string"
    ) {

      try {

        const parsed =
          JSON.parse(
            value
          );


        if (
          parsed &&
          typeof parsed === "object"
        ) {

          if (
            Array.isArray(parsed)
          ) {

            for (
              const row
              of parsed
            ) {

              const sku =
                getObjectSKU(
                  row
                );


              if (sku) {
                return sku;
              }
            }

          } else {

            const sku =
              getObjectSKU(
                parsed
              );


            if (sku) {
              return sku;
            }
          }
        }

      } catch (_) {

        /*
         * Bukan JSON.
         */
      }
    }
  }


  return "";
}


function getObjectSKU(
  object
) {

  if (
    !object ||
    typeof object !== "object"
  ) {
    return "";
  }


  const sku =

    object["Product SKU"] ??
    object["ProductSKU"] ??
    object["SKU"] ??
    object["Sku"] ??
    object["sku"];


  if (
    sku === undefined ||
    sku === null
  ) {

    return "";
  }


  return String(
    sku
  ).trim();
}


/* ============================================================
   LOOKUP SKU
   ============================================================ */

function lookupSKU(
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
   GET CSV VALUE
   ============================================================ */

function getValue(
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
   DOWNLOAD BINARY
   ============================================================ */

async function downloadBinary(
  url
) {

  const response =
    await fetch(
      url,
      {
        headers: {
          "User-Agent":
            "guardian-pdf-worker"
        }
      }
    );


  if (
    !response.ok
  ) {

    throw new Error(
      `Gagal mengambil file GitHub: ${response.status} ${url}`
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
            "guardian-pdf-worker"
        }
      }
    );


  if (
    !response.ok
  ) {

    throw new Error(
      `Gagal mengambil CSV GitHub: ${response.status}`
    );
  }


  return await response.text();
}


/* ============================================================
   BASE64 TO BYTES
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
   * data:image/png;base64,...
   *
   * atau
   *
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


  const binary =
    atob(
      text
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


/* ============================================================
   BYTES TO BASE64
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
   JPG DETECTION
   ============================================================ */

function isJPG(
  bytes
) {

  return (
    bytes[0] === 0xFF &&
    bytes[1] === 0xD8 &&
    bytes[2] === 0xFF
  );
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
   RESPONSE
   ============================================================ */

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
