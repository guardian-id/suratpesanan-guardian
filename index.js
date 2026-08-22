import {
  PDFDocument,
  StandardFonts,
  rgb
} from "pdf-lib";

import {
  getDocument
} from "pdfjs-serverless";


/*
=========================================================
CLOUDFLARE WORKER
PDF AUTOMATION
=========================================================

INPUT POWER AUTOMATE:

{
  "template": "Reguler",

  "pdfBase64": "...",

  "ttdBase64": "...",

  "stempelBase64": "...",

  "Satu": "...",
  "Dua": "...",
  "Tiga": "...",
  "Empat": "...",
  "Lima": "...",
  "Enam": "...",
  "Tujuh": "...",
  "Delapan": "...",
  "Sembilan": "...",
  "Sepuluh": "...",
  "Sebelas": "...",
  "Duabelas": "..."
}


UNTUK PREKURSOR:

"Satu" biasanya berisi Product SKU
atau field yang kita tentukan sebagai SKU.

Worker akan:

1. Memilih template
2. Membaca PDF
3. Mencari placeholder
4. Mengganti nilai
5. Jika Prekursor:
      SKU -> master_prekursor.csv
      -> Zat Aktif
      -> Bentuk
6. Mencari TTD / Stempel
7. Menempel gambar
8. Return PDF Base64
=========================================================
*/


/*
=========================================================
GITHUB CONFIGURATION
=========================================================

GANTI 3 BAGIAN INI
=========================================================
*/

const GITHUB_RAW_BASE =
  "https://raw.githubusercontent.com/USERNAME/REPOSITORY/main";


const REGULER_PDF_URL =
  `${GITHUB_RAW_BASE}/Reguler.pdf`;


const PREKURSOR_PDF_URL =
  `${GITHUB_RAW_BASE}/Prekursor.pdf`;


const MASTER_PREKURSOR_CSV_URL =
  `${GITHUB_RAW_BASE}/master_prekursor.csv`;


/*
=========================================================
PLACEHOLDERS
=========================================================
*/

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


/*
=========================================================
MAIN WORKER
=========================================================
*/

export default {

  async fetch(request, env, ctx) {

    /*
    -----------------------------------------------------
    CORS PREFLIGHT
    -----------------------------------------------------
    */

    if (request.method === "OPTIONS") {

      return new Response(null, {
        status: 204,

        headers: corsHeaders()

      });

    }


    /*
    -----------------------------------------------------
    ONLY POST
    -----------------------------------------------------
    */

    if (request.method !== "POST") {

      return jsonResponse({

        success: false,

        message:
          "Method harus POST."

      }, 405);

    }


    try {

      /*
      ===================================================
      1. READ JSON
      ===================================================
      */

      const body =
        await request.json();


      /*
      ===================================================
      2. TEMPLATE
      ===================================================
      */

      const template =
        normalizeTemplate(
          body.template
        );


      if (
        template !== "reguler" &&
        template !== "prekursor"
      ) {

        return jsonResponse({

          success: false,

          message:
            "Template tidak valid. Gunakan Reguler atau Prekursor.",

          receivedTemplate:
            body.template || null

        }, 400);

      }


      /*
      ===================================================
      3. GET PDF TEMPLATE
      ===================================================
      */

      const pdfBytes =
        await getTemplatePdf(
          template
        );


      /*
      ===================================================
      4. LOAD PDF-LIB
      ===================================================
      */

      const pdfDoc =
        await PDFDocument.load(
          pdfBytes
        );


      /*
      ===================================================
      5. EXTRACT TEXT POSITION USING PDF.JS
      ===================================================
      */

      const pdfJsDocument =
        await getDocument({

          data:
            pdfBytes,

          useSystemFonts:
            true

        }).promise;


      /*
      ===================================================
      6. FONT
      ===================================================
      */

      const font =
        await pdfDoc.embedFont(
          StandardFonts.Helvetica
        );


      /*
      ===================================================
      7. POWER AUTOMATE VALUES
      ===================================================
      */

      const values = {};

      for (
        const key of PLACEHOLDERS
      ) {

        values[key] =
          safeString(
            body[key]
          );

      }


      /*
      ===================================================
      8. PREKURSOR LOOKUP
      ===================================================
      */

      let prekursorData = null;

      if (
        template === "prekursor"
      ) {

        /*
        -----------------------------------------------
        PRODUCT SKU
        -----------------------------------------------

        Untuk sementara kita menggunakan Satu
        sebagai Product SKU.

        Kalau nanti ternyata SKU berasal dari
        field lain, cukup ubah bagian ini.
        -----------------------------------------------
        */

        const productSku =
          values.Satu;


        if (
          productSku
        ) {

          prekursorData =
            await lookupPrekursor(
              productSku
            );

        }

      }


      /*
      ===================================================
      9. PROCESS EACH PDF PAGE
      ===================================================
      */

      const pages =
        pdfDoc.getPages();


      for (
        let pageIndex = 0;
        pageIndex < pages.length;
        pageIndex++
      ) {

        const page =
          pages[pageIndex];


        /*
        -----------------------------------------------
        PDF.JS PAGE
        -----------------------------------------------
        */

        const pdfJsPage =
          await pdfJsDocument.getPage(
            pageIndex + 1
          );


        /*
        -----------------------------------------------
        TEXT CONTENT
        -----------------------------------------------
        */

        const textContent =
          await pdfJsPage.getTextContent();


        const textItems =
          textContent.items
            .filter(
              item =>
                typeof item.str === "string" &&
                item.str.length > 0
            );


        /*
        =================================================
        9A. REPLACE SATU - DUABELAS
        =================================================
        */

        for (
          const placeholder of PLACEHOLDERS
        ) {

          const value =
            values[placeholder];


          /*
          Jangan melakukan apa-apa kalau kosong.
          */

          if (
            !value
          ) {

            continue;

          }


          /*
          Cari placeholder.
          */

          const location =
            findTextLocation(
              textItems,
              placeholder,
              page.getHeight()
            );


          /*
          Kalau placeholder tidak ada,
          lanjut ke placeholder berikutnya.
          */

          if (
            !location
          ) {

            continue;

          }


          /*
          Tutup tulisan lama.
          */

          coverText(
            page,
            location,
            2
          );


          /*
          Tulis nilai baru.
          */

          drawReplacementText(
            page,
            font,
            value,
            location
          );

        }


        /*
        =================================================
        9B. PREKURSOR
        =================================================
        */

        if (
          template === "prekursor" &&
          prekursorData
        ) {

          /*
          ZAT AKTIF
          */

          if (
            prekursorData.zatAktif
          ) {

            await replaceKeywordValue({

              page,

              textItems,

              keyword:
                "Zat Aktif",

              value:
                prekursorData.zatAktif,

              font

            });

          }


          /*
          BENTUK
          */

          if (
            prekursorData.bentuk
          ) {

            await replaceKeywordValue({

              page,

              textItems,

              keyword:
                "Bentuk",

              value:
                prekursorData.bentuk,

              font

            });

          }

        }


        /*
        =================================================
        9C. TTD + STEMPEL
        =================================================
        */

        if (
          body.ttdBase64 ||
          body.stempelBase64
        ) {

          await placeSignatureBlock({

            pdfDoc,

            page,

            textItems,

            ttdBase64:
              body.ttdBase64,

            stempelBase64:
              body.stempelBase64

          });

        }

      }


      /*
      ===================================================
      10. SAVE PDF
      ===================================================
      */

      const outputBytes =
        await pdfDoc.save();


      /*
      ===================================================
      11. BASE64
      ===================================================
      */

      const outputBase64 =
        uint8ArrayToBase64(
          outputBytes
        );


      /*
      ===================================================
      12. OUTPUT
      ===================================================
      */

      const fileName =
        template === "prekursor"
          ? "hasil_prekursor.pdf"
          : "hasil_reguler.pdf";


      return jsonResponse({

        success: true,

        template,

        fileName,

        contentType:
          "application/pdf",

        pdfBase64:
          outputBase64,

        /*
        Informasi debugging
        */

        prekursorLookup:
          template === "prekursor"
            ? prekursorData
            : null

      });

    }


    /*
    =====================================================
    ERROR HANDLER
    =====================================================
    */

    catch (error) {

      console.error(
        error
      );


      return jsonResponse({

        success: false,

        message:
          error?.message ||
          "Unknown error.",

        error:
          String(error)

      }, 500);

    }

  }

};


/*
=========================================================
GET TEMPLATE PDF
=========================================================
*/

async function getTemplatePdf(
  template
) {

  const url =
    template === "prekursor"
      ? PREKURSOR_PDF_URL
      : REGULER_PDF_URL;


  const response =
    await fetch(
      url,
      {

        method:
          "GET",

        headers: {

          "Accept":
            "application/pdf"

        }

      }
    );


  if (
    !response.ok
  ) {

    throw new Error(

      `Gagal mengambil template PDF dari GitHub. ` +
      `HTTP ${response.status}. URL: ${url}`

    );

  }


  const arrayBuffer =
    await response.arrayBuffer();


  if (
    arrayBuffer.byteLength === 0
  ) {

    throw new Error(
      "Template PDF kosong."
    );

  }


  return new Uint8Array(
    arrayBuffer
  );

}


/*
=========================================================
FIND TEXT LOCATION
=========================================================

PDF.js text item mempunyai transform:

[ scaleX, skewX, skewY, scaleY, x, y ]

Kita konversi menjadi koordinat PDF-lib.
=========================================================
*/

function findTextLocation(
  textItems,
  target,
  pageHeight
) {

  const normalizedTarget =
    normalizeText(
      target
    );


  /*
  -----------------------------------------------------
  EXACT MATCH
  -----------------------------------------------------
  */

  for (
    const item of textItems
  ) {

    const text =
      normalizeText(
        item.str
      );


    if (
      text === normalizedTarget
    ) {

      return textItemToLocation(
        item,
        pageHeight
      );

    }

  }


  /*
  -----------------------------------------------------
  CONTAINS
  -----------------------------------------------------
  */

  for (
    const item of textItems
  ) {

    const text =
      normalizeText(
        item.str
      );


    if (
      text.includes(
        normalizedTarget
      )
    ) {

      return textItemToLocation(
        item,
        pageHeight
      );

    }

  }


  /*
  -----------------------------------------------------
  TOKEN MATCH
  -----------------------------------------------------

  Berguna apabila PDF memecah teks.
  -----------------------------------------------------
  */

  const words =
    normalizedTarget.split(
      " "
    );


  if (
    words.length > 1
  ) {

    for (
      let i = 0;
      i < textItems.length;
      i++
    ) {

      const combined =
        textItems
          .slice(
            i,
            i + words.length + 2
          )
          .map(
            item =>
              normalizeText(
                item.str
              )
          )
          .join(" ");


      if (
        combined.includes(
          normalizedTarget
        )
      ) {

        return textItemToLocation(
          textItems[i],
          pageHeight
        );

      }

    }

  }


  return null;

}


/*
=========================================================
TEXT ITEM -> PDF LOCATION
=========================================================
*/

function textItemToLocation(
  item,
  pageHeight
) {

  const x =
    Number(
      item.transform?.[4] || 0
    );


  const rawY =
    Number(
      item.transform?.[5] || 0
    );


  const rawHeight =
    Math.abs(
      Number(
        item.transform?.[3] || 10
      )
    );


  const width =
    Number(
      item.width || 20
    );


  /*
  PDF.js text coordinates are based
  on the text transform.

  We use the baseline and compensate
  by text height.
  */

  const y =
    rawY;


  return {

    x,

    y,

    width,

    height:
      Math.max(
        rawHeight,
        10
      )

  };

}


/*
=========================================================
COVER ORIGINAL TEXT
=========================================================
*/

function coverText(
  page,
  location,
  padding = 2
) {

  page.drawRectangle({

    x:
      location.x - padding,

    y:
      location.y - padding,

    width:
      Math.max(
        location.width +
        padding * 2,

        20
      ),

    height:
      Math.max(
        location.height +
        padding * 2,

        12
      ),

    color:
      rgb(
        1,
        1,
        1
      ),

    opacity:
      1

  });

}


/*
=========================================================
DRAW REPLACEMENT TEXT
=========================================================
*/

function drawReplacementText(
  page,
  font,
  value,
  location
) {

  const fontSize =
    9;


  page.drawText(

    String(value),

    {

      x:
        location.x,

      y:
        location.y,

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
        450,

      lineHeight:
        11

    }

  );

}


/*
=========================================================
PREKURSOR:
REPLACE KEYWORD VALUE
=========================================================
*/

async function replaceKeywordValue({

  page,

  textItems,

  keyword,

  value,

  font

}) {

  if (
    !value
  ) {

    return false;

  }


  const location =
    findTextLocation(

      textItems,

      keyword,

      page.getHeight()

    );


  if (
    !location
  ) {

    return false;

  }


  /*
  -----------------------------------------------------
  Tutup area keyword + area value.
  -----------------------------------------------------
  */

  page.drawRectangle({

    x:
      location.x - 2,

    y:
      location.y - 2,

    width:
      Math.max(
        location.width +
        300,

        100
      ),

    height:
      Math.max(
        location.height +
        4,

        14
      ),

    color:
      rgb(
        1,
        1,
        1
      )

  });


  /*
  -----------------------------------------------------
  Tulis value
  -----------------------------------------------------
  */

  page.drawText(

    String(value),

    {

      x:
        location.x,

      y:
        location.y,

      size:
        9,

      font,

      color:
        rgb(
          0,
          0,
          0
        ),

      maxWidth:
        300,

      lineHeight:
        11

    }

  );


  return true;

}


/*
=========================================================
PREKURSOR CSV LOOKUP
=========================================================
*/

async function lookupPrekursor(
  productSku
) {

  const sku =
    normalizeSku(
      productSku
    );


  if (
    !sku
  ) {

    return null;

  }


  /*
  -----------------------------------------------------
  GET CSV
  -----------------------------------------------------
  */

  const response =
    await fetch(
      MASTER_PREKURSOR_CSV_URL
    );


  if (
    !response.ok
  ) {

    throw new Error(

      `Gagal mengambil master_prekursor.csv. ` +
      `HTTP ${response.status}`

    );

  }


  const csvText =
    await response.text();


  /*
  -----------------------------------------------------
  PARSE CSV
  -----------------------------------------------------
  */

  const rows =
    parseCSV(
      csvText
    );


  if (
    rows.length < 2
  ) {

    throw new Error(
      "master_prekursor.csv tidak mempunyai data."
    );

  }


  /*
  -----------------------------------------------------
  HEADERS
  -----------------------------------------------------
  */

  const headers =
    rows[0].map(
      header =>
        normalizeHeader(
          header
        )
    );


  /*
  -----------------------------------------------------
  FIND COLUMNS
  -----------------------------------------------------
  */

  const skuIndex =
    findColumnIndex(

      headers,

      [
        "product sku",
        "sku",
        "productsku"
      ]

    );


  const zatAktifIndex =
    findColumnIndex(

      headers,

      [
        "zat aktif",
        "zataktif",
        "active ingredient",
        "activeingredient"
      ]

    );


  const bentukIndex =
    findColumnIndex(

      headers,

      [
        "bentuk",
        "form",
        "dosage form",
        "dosageform"
      ]

    );


  if (
    skuIndex === -1
  ) {

    throw new Error(

      "Kolom Product SKU tidak ditemukan di master_prekursor.csv."

    );

  }


  /*
  -----------------------------------------------------
  SEARCH ROW
  -----------------------------------------------------
  */

  for (
    let i = 1;
    i < rows.length;
    i++
  ) {

    const row =
      rows[i];


    const rowSku =
      normalizeSku(
        row[skuIndex]
      );


    if (
      rowSku === sku
    ) {

      return {

        found:
          true,

        productSku:
          row[skuIndex] || "",

        zatAktif:
          zatAktifIndex >= 0
            ? row[zatAktifIndex] || ""
            : "",

        bentuk:
          bentukIndex >= 0
            ? row[bentukIndex] || ""
            : ""

      };

    }

  }


  /*
  -----------------------------------------------------
  SKU NOT FOUND
  -----------------------------------------------------
  */

  return {

    found:
      false,

    productSku:
      productSku,

    zatAktif:
      "",

    bentuk:
      ""

  };

}


/*
=========================================================
TTD + STEMPEL
=========================================================

Kita jadikan satu blok visual:

TTD
+
STEMPEL

Posisi utama berdasarkan keyword "TTD".

Kalau TTD tidak ditemukan,
coba keyword "Stempel".

Kalau keduanya tidak ditemukan,
gunakan fallback.

Posisi dapat kita fine tune setelah test
menggunakan PDF asli.
=========================================================
*/

async function placeSignatureBlock({

  pdfDoc,

  page,

  textItems,

  ttdBase64,

  stempelBase64

}) {

  /*
  -----------------------------------------------------
  FIND TTD
  -----------------------------------------------------
  */

  const ttdLocation =
    findTextLocation(

      textItems,

      "TTD",

      page.getHeight()

    );


  /*
  -----------------------------------------------------
  FIND STEMPEL
  -----------------------------------------------------
  */

  const stempelLocation =
    findTextLocation(

      textItems,

      "Stempel",

      page.getHeight()

    );


  /*
  -----------------------------------------------------
  SELECT ANCHOR
  -----------------------------------------------------
  */

  let anchor =
    ttdLocation ||
    stempelLocation;


  /*
  -----------------------------------------------------
  FALLBACK
  -----------------------------------------------------
  */

  if (
    !anchor
  ) {

    anchor = {

      x:
        page.getWidth() -
        180,

      y:
        70,

      width:
        100,

      height:
        20

    };

  }


  /*
  =====================================================
  POSITION ADJUSTMENT
  =====================================================

  Percakapan sebelumnya:
  - awalnya dinaikkan sekitar 3 cm
  - kemudian diturunkan sekitar 2 cm

  Hasil akhir:
  kita menggunakan offset sekitar +1 cm
  dari posisi dasar.

  1 cm ≈ 28.35 PDF points.

  Nilai ini mudah kita ubah setelah test.
  =====================================================
  */

  const POSITION_X =
    0;

  const POSITION_Y =
    28.35;


  const baseX =
    anchor.x +
    POSITION_X;


  const baseY =
    anchor.y +
    POSITION_Y;


  /*
  =====================================================
  TTD
  =====================================================
  */

  let ttdImage =
    null;


  if (
    ttdBase64
  ) {

    const ttdBytes =
      base64ToUint8Array(
        cleanBase64(
          ttdBase64
        )
      );


    ttdImage =
      await embedImage(
        pdfDoc,
        ttdBytes
      );

  }


  /*
  =====================================================
  STEMPEL
  =====================================================
  */

  let stempelImage =
    null;


  if (
    stempelBase64
  ) {

    const stempelBytes =
      base64ToUint8Array(
        cleanBase64(
          stempelBase64
        )
      );


    stempelImage =
      await embedImage(
        pdfDoc,
        stempelBytes
      );

  }


  /*
  =====================================================
  DRAW TTD
  =====================================================
  */

  if (
    ttdImage
  ) {

    const ttdWidth =
      100;


    const ttdHeight =
      getImageHeight(
        ttdImage,
        ttdWidth
      );


    page.drawImage(

      ttdImage,

      {

        x:
          baseX,

        y:
          baseY,

        width:
          ttdWidth,

        height:
          ttdHeight

      }

    );

  }


  /*
  =====================================================
  DRAW STEMPEL
  =====================================================
  */

  if (
    stempelImage
  ) {

    const stempelWidth =
      65;


    const stempelHeight =
      getImageHeight(
        stempelImage,
        stempelWidth
      );


    /*
    Stempel sedikit ke kanan
    dan sedikit ke bawah dibanding TTD.
    */

    page.drawImage(

      stempelImage,

      {

        x:
          baseX +
          60,

        y:
          baseY -
          8,

        width:
          stempelWidth,

        height:
          stempelHeight

      }

    );

  }

}


/*
=========================================================
EMBED IMAGE
=========================================================
*/

async function embedImage(
  pdfDoc,
  bytes
) {

  /*
  PNG signature
  */

  if (

    bytes.length >= 8 &&

    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4E &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0D &&
    bytes[5] === 0x0A &&
    bytes[6] === 0x1A &&
    bytes[7] === 0x0A

  ) {

    return await pdfDoc.embedPng(
      bytes
    );

  }


  /*
  JPEG signature
  */

  if (

    bytes.length >= 2 &&

    bytes[0] === 0xFF &&
    bytes[1] === 0xD8

  ) {

    return await pdfDoc.embedJpg(
      bytes
    );

  }


  throw new Error(
    "TTD/Stempel hanya mendukung PNG atau JPEG."
  );

}


/*
=========================================================
IMAGE HEIGHT
=========================================================
*/

function getImageHeight(
  image,
  width
) {

  if (
    !image.width ||
    !image.height
  ) {

    return width;

  }


  return (
    width *
    image.height /
    image.width
  );

}


/*
=========================================================
BASE64 CLEAN
=========================================================
*/

function cleanBase64(
  value
) {

  if (
    !value
  ) {

    return "";

  }


  let text =
    String(value);


  /*
  -----------------------------------------------------
  CASE:

  <img src="data:image/png;base64,XXXXX">
  -----------------------------------------------------
  */

  const imgMatch =
    text.match(
      /base64,([^"'<>]+)/i
    );


  if (
    imgMatch
  ) {

    text =
      imgMatch[1];

  }


  /*
  -----------------------------------------------------
  CASE:

  data:image/png;base64,XXXXX
  -----------------------------------------------------
  */

  text =
    text.replace(

      /^data:[^;]+;base64,/i,

      ""

    );


  /*
  -----------------------------------------------------
  REMOVE WHITESPACE
  -----------------------------------------------------
  */

  text =
    text.replace(
      /\s/g,
      ""
    );


  return text;

}


/*
=========================================================
BASE64 -> UINT8ARRAY
=========================================================
*/

function base64ToUint8Array(
  base64
) {

  if (
    !base64
  ) {

    throw new Error(
      "Base64 kosong."
    );

  }


  let binary;


  try {

    binary =
      atob(
        base64
      );

  }

  catch (error) {

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


/*
=========================================================
UINT8ARRAY -> BASE64
=========================================================
*/

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

    const chunk =
      bytes.subarray(

        i,

        Math.min(
          i + chunkSize,
          bytes.length
        )

      );


    binary +=
      String.fromCharCode(
        ...chunk
      );

  }


  return btoa(
    binary
  );

}


/*
=========================================================
CSV PARSER
=========================================================

Mendukung:
- comma
- quoted field
- comma di dalam quote
- newline di dalam quote
=========================================================
*/

function parseCSV(
  text
) {

  const rows = [];

  let row = [];

  let field = "";

  let insideQuotes =
    false;


  for (
    let i = 0;
    i < text.length;
    i++
  ) {

    const char =
      text[i];


    const next =
      text[i + 1];


    /*
    Double quote di dalam quoted field
    */

    if (

      char === '"' &&

      insideQuotes &&

      next === '"'

    ) {

      field += '"';

      i++;

      continue;

    }


    /*
    Open / close quote
    */

    if (
      char === '"'
    ) {

      insideQuotes =
        !insideQuotes;

      continue;

    }


    /*
    Comma
    */

    if (

      char === "," &&

      !insideQuotes

    ) {

      row.push(
        field
      );

      field = "";

      continue;

    }


    /*
    Newline
    */

    if (

      (char === "\n" ||
       char === "\r") &&

      !insideQuotes

    ) {

      if (

        char === "\r" &&

        next === "\n"

      ) {

        i++;

      }


      row.push(
        field
      );


      rows.push(
        row
      );


      row = [];

      field = "";

      continue;

    }


    field += char;

  }


  /*
  Remaining data
  */

  if (

    field.length > 0 ||

    row.length > 0

  ) {

    row.push(
      field
    );


    rows.push(
      row
    );

  }


  return rows;

}


/*
=========================================================
NORMALIZE HEADER
=========================================================
*/

function normalizeHeader(
  value
) {

  return String(
    value || ""
  )
    .trim()
    .toLowerCase()
    .replace(
      /[_-]/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    );

}


/*
=========================================================
FIND COLUMN
=========================================================
*/

function findColumnIndex(
  headers,
  possibleNames
) {

  for (
    const name of possibleNames
  ) {

    const index =
      headers.indexOf(
        name
      );


    if (
      index !== -1
    ) {

      return index;

    }

  }


  return -1;

}


/*
=========================================================
NORMALIZE SKU
=========================================================
*/

function normalizeSku(
  value
) {

  return String(
    value || ""
  )
    .trim()
    .replace(
      /\.0$/,
      ""
    )
    .replace(
      /\s/g,
      ""
    )
    .toLowerCase();

}


/*
=========================================================
NORMALIZE TEXT
=========================================================
*/

function normalizeText(
  value
) {

  return String(
    value || ""
  )
    .trim()
    .toLowerCase()
    .replace(
      /\s+/g,
      " "
    );

}


/*
=========================================================
NORMALIZE TEMPLATE
=========================================================
*/

function normalizeTemplate(
  value
) {

  const text =
    String(
      value || ""
    )
      .trim()
      .toLowerCase();


  if (
    text === "prekursor" ||
    text === "prekusor"
  ) {

    return "prekursor";

  }


  if (
    text === "reguler" ||
    text === "regular"
  ) {

    return "reguler";

  }


  return text;

}


/*
=========================================================
SAFE STRING
=========================================================
*/

function safeString(
  value
) {

  if (
    value === null ||
    value === undefined
  ) {

    return "";

  }


  return String(
    value
  );

}


/*
=========================================================
CORS
=========================================================
*/

function corsHeaders() {

  return {

    "Access-Control-Allow-Origin":
      "*",

    "Access-Control-Allow-Methods":
      "POST, OPTIONS",

    "Access-Control-Allow-Headers":
      "Content-Type"

  };

}


/*
=========================================================
JSON RESPONSE
=========================================================
*/

function jsonResponse(
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
          "application/json",

        ...corsHeaders()

      }

    }

  );

}
