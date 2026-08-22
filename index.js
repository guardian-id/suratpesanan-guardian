import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
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
         TEMPLATE
         ===================================================== */

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


      const isPrekursor =
        template === "prekursor";


      /* =====================================================
         INPUT PDF
         ===================================================== */

      const pdfBase64 =
        body.pdfBase64 || "";


      if (!pdfBase64) {
        throw new Error(
          "pdfBase64 wajib dikirim."
        );
      }


      const uploadedPdfBytes =
        base64ToBytes(
          pdfBase64
        );


      validatePDF(
        uploadedPdfBytes,
        "pdfBase64"
      );


      /* =====================================================
         PILIH TEMPLATE GITHUB
         ===================================================== */

      const templateUrl =
        isPrekursor
          ? PREKURSOR_URL
          : REGULER_URL;


      const templateBytes =
        await downloadBytes(
          templateUrl
        );


      validatePDF(
        templateBytes,
        "Template PDF"
      );


      /* =====================================================
         LOAD TEMPLATE
         ===================================================== */

      const pdf =
        await PDFDocument.load(
          templateBytes
        );


      /* =====================================================
         DATA Satu - Duabelas
         ===================================================== */

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


      /* =====================================================
         PREKURSOR
         
         PDF UPLOAD → CARI SKU → MASTER CSV
         ===================================================== */

      let productSKU = "";
      let zatAktif = "";
      let bentuk = "";


      if (isPrekursor) {

        const uploadedText =
          await extractPDFText(
            uploadedPdfBytes
          );


        const skuList =
          extractSKUsFromPDF(
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


        const masterRows =
          parseCSV(
            masterCsv
          );


        let found = null;


        for (
          const sku of skuList
        ) {

          const result =
            findSKU(
              masterRows,
              sku
            );


          if (result) {

            found =
              result;

            productSKU =
              sku;

            break;
          }
        }


        if (!found) {

          throw new Error(
            `SKU ${skuList.join(", ")} tidak ditemukan di master_prekursor.csv`
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


        data.ZatAktif =
          zatAktif;


        data.Bentuk =
          bentuk;
      }


      /* =====================================================
         REPLACE TEXT
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
        templateBytes,
        body.ttdBase64 || "",
        body.stempelBase64 || ""
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


      const response = {

        success: true,

        message:
          "PDF berhasil diproses.",

        template:
          isPrekursor
            ? "Prekursor"
            : "Reguler",

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
            "Terjadi error.",

          stack:
            error?.stack || ""
        },
        500
      );
    }
  }
};


/* =========================================================
   EXTRACT PDF TEXT
   ========================================================= */

async function extractPDFText(
  pdfBytes
) {

  const loadingTask =
    getDocument({
      data:
        new Uint8Array(
          pdfBytes
        )
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


/* =========================================================
   REPLACE PDF PLACEHOLDERS
   ========================================================= */

async function replacePDFPlaceholders(
  pdf,
  originalBytes,
  data
) {

  const loadingTask =
    getDocument({
      data:
        new Uint8Array(
          originalBytes
        )
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


    const pdfPage =
      pages[pageIndex];


    if (!pdfPage) {
      continue;
    }


    for (
      const placeholder of Object.keys(
        data
      )
    ) {

      const rawValue =
        data[
          placeholder
        ];


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


        const fontSize =
          Math.abs(
            transform[3]
          ) || 10;


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
          fontSize *
          1.35;


        /*
         * Hapus placeholder
         */

        pdfPage.drawRectangle({
          x:
            x - 1,

          y:
            y - 2,

          width:
            placeholderWidth + 5,

          height:
            height + 4,

          color:
            rgb(
              1,
              1,
              1
            )
        });


        /*
         * Kalau kosong,
         * cukup hapus placeholder.
         */

        if (
          value === ""
        ) {
          continue;
        }


        /*
         * Tulis text baru.
         */

        pdfPage.drawText(
          value,
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

            maxWidth:
              Math.max(
                placeholderWidth + 100,
                100
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
    await sourcePdf.destroy();
  } catch (_) {}
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
   * Text dalam satu item
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
      item.str.includes(
        target
      )
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
   * Text terpecah
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
        first =
          item;
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


/* =========================================================
   REMOVE DUPLICATES
   ========================================================= */

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


/* =========================================================
   COMBINED WIDTH
   ========================================================= */

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


  const x1 =
    first.transform?.[4] || 0;


  const x2 =
    last.transform?.[4] || 0;


  return Math.abs(
    x2 - x1
  ) +
  (
    last.width || 0
  );
}


/* =========================================================
   TTD + STEMPEL
   ========================================================= */

async function addTTDAndStamp(
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


  let ttd =
    null;

  let stamp =
    null;


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


  /*
   * Baca posisi keyword TTD/Stempel
   * dari template.
   */

  const loadingTask =
    getDocument({
      data:
        new Uint8Array(
          templateBytes
        )
    });


  const sourcePdf =
    await loadingTask.promise;


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


    const page =
      pages[pageIndex];


    if (!page) {
      continue;
    }


    /*
     * TTD
     */

    if (ttd) {

      const matches =
        findTextMatches(
          items,
          "TTD"
        );


      if (
        matches.length > 0
      ) {

        const match =
          matches[0];


        const x =
          match.transform[4];


        const y =
          match.transform[5];


        /*
         * Tutup keyword
         */

        page.drawRectangle({
          x:
            x - 2,

          y:
            y - 8,

          width:
            Math.max(
              match.width || 25,
              25
            ) + 5,

          height:
            18,

          color:
            rgb(
              1,
              1,
              1
            )
        });


        /*
         * TTD
         */

        page.drawImage(
          ttd,
          {
            x:
              x - 20,

            y:
              y + 8,

            width:
              105,

            height:
              55
          }
        );
      }
    }


    /*
     * STEMPEL
     */

    if (stamp) {

      const matches =
        findTextMatches(
          items,
          "Stempel"
        );


      if (
        matches.length > 0
      ) {

        const match =
          matches[0];


        const x =
          match.transform[4];


        const y =
          match.transform[5];


        page.drawRectangle({
          x:
            x - 2,

          y:
            y - 8,

          width:
            Math.max(
              match.width || 50,
              50
            ) + 5,

          height:
            18,

          color:
            rgb(
              1,
              1,
              1
            )
        });


        page.drawImage(
          stamp,
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
    await sourcePdf.destroy();
  } catch (_) {}
}


/* =========================================================
   EXTRACT SKU DARI PDF
   ========================================================= */

function extractSKUsFromPDF(
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
          x =>
            String(x).trim()
        )
        .filter(Boolean)
    )
  ];
}


/* =========================================================
   CSV
   ========================================================= */

function parseCSV(
  text
) {

  text =
    String(
      text || ""
    )
      .replace(
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


  if (
    !lines.length
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

  let current =
    "";

  let quoted =
    false;


  for (
    let i = 0;
    i < line.length;
    i++
  ) {

    const c =
      line[i];


    if (
      c === '"'
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
      c === "," &&
      !quoted
    ) {

      result.push(
        current.trim()
      );

      current =
        "";

    } else {

      current +=
        c;
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
   DOWNLOAD
   ========================================================= */

async function downloadBytes(
  url
) {

  const response =
    await fetch(
      url
    );


  if (
    !response.ok
  ) {

    throw new Error(
      `Gagal mengambil file: HTTP ${response.status}`
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
      url
    );


  if (
    !response.ok
  ) {

    throw new Error(
      `Gagal mengambil CSV: HTTP ${response.status}`
    );
  }


  return await response.text();
}


/* =========================================================
   BASE64
   ========================================================= */

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
   * <img src="data:image/png;base64,...">
   */

  const img =
    value.match(
      /<img[^>]+src=["']data:image\/[^;]+;base64,([^"']+)["']/i
    );


  if (
    img &&
    img[1]
  ) {

    value =
      img[1];
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

  let binary =
    "";

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


  return btoa(
    binary
  );
}


/* =========================================================
   VALIDATE PDF
   ========================================================= */

function validatePDF(
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
      `${name} bukan PDF valid.`
    );
  }
}


/* =========================================================
   JPG
   ========================================================= */

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


/* =========================================================
   CLEAN
   ========================================================= */

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
