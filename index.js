import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const MASTER_PREKURSOR_CSV_URL =
  "https://raw.githubusercontent.com/USERNAME/REPOSITORY/main/master_prekursor.csv";

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

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    if (request.method !== "POST") {
      return jsonResponse({
        success: false,
        message: "Method harus POST."
      }, 405);
    }

    try {

      const body = await request.json();

      console.log("STEP 1 - JSON diterima");

      const template = normalizeTemplate(body.template);

      if (
        template !== "reguler" &&
        template !== "prekursor"
      ) {
        throw new Error(
          "template harus Reguler atau Prekursor."
        );
      }

      if (!body.pdfBase64) {
        throw new Error(
          "pdfBase64 tidak ditemukan."
        );
      }

      console.log(
        "STEP 2 - Template:",
        template
      );

      /*
      ==================================================
      PDF
      ==================================================
      */

      const pdfBytes = base64ToUint8Array(
        cleanBase64(body.pdfBase64)
      );

      console.log(
        "STEP 3 - PDF bytes:",
        pdfBytes.length
      );

      if (
        pdfBytes.length < 5 ||
        String.fromCharCode(
          pdfBytes[0],
          pdfBytes[1],
          pdfBytes[2],
          pdfBytes[3]
        ) !== "%PDF"
      ) {
        throw new Error(
          "pdfBase64 bukan PDF yang valid."
        );
      }

      const pdfDoc =
        await PDFDocument.load(pdfBytes);

      const pages =
        pdfDoc.getPages();

      console.log(
        "STEP 4 - Pages:",
        pages.length
      );

      /*
      ==================================================
      FONT
      ==================================================
      */

      const font =
        await pdfDoc.embedFont(
          StandardFonts.Helvetica
        );

      /*
      ==================================================
      PREKURSOR LOOKUP
      ==================================================
      */

      let prekursor = null;

      if (template === "prekursor") {

        const productSku =
          cleanSku(
            body.productSku ||
            body.ProductSKU ||
            body.SKU ||
            body.sku
          );

        console.log(
          "STEP 5 - Product SKU:",
          productSku
        );

        if (!productSku) {
          throw new Error(
            "Template Prekursor membutuhkan productSku."
          );
        }

        prekursor =
          await lookupPrekursor(
            productSku
          );

        if (!prekursor.found) {
          throw new Error(
            `Product SKU ${productSku} tidak ditemukan di master_prekursor.csv`
          );
        }

        console.log(
          "STEP 6 - Prekursor ditemukan:",
          prekursor
        );
      }

      /*
      ==================================================
      IMAGE TTD
      ==================================================
      */

      let ttdImage = null;
      let stempelImage = null;

      if (body.ttdBase64) {

        ttdImage =
          await embedImage(
            pdfDoc,
            base64ToUint8Array(
              cleanBase64(
                body.ttdBase64
              )
            )
          );

        console.log(
          "STEP 7 - TTD loaded"
        );
      }

      if (body.stempelBase64) {

        stempelImage =
          await embedImage(
            pdfDoc,
            base64ToUint8Array(
              cleanBase64(
                body.stempelBase64
              )
            )
          );

        console.log(
          "STEP 8 - Stempel loaded"
        );
      }

      /*
      ==================================================
      PROCESS EVERY PAGE
      ==================================================
      */

      const processedPages = [];

      for (
        let pageIndex = 0;
        pageIndex < pages.length;
        pageIndex++
      ) {

        const page =
          pages[pageIndex];

        console.log(
          `STEP 9 - Processing page ${pageIndex + 1}`
        );

        /*
        ----------------------------------------------
        DATA
        ----------------------------------------------
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
        ----------------------------------------------
        PREKURSOR
        ----------------------------------------------
        */

        if (
          template === "prekursor" &&
          prekursor
        ) {

          values.ZatAktif =
            prekursor.zatAktif;

          values.Bentuk =
            prekursor.bentuk;

        }

        /*
        ----------------------------------------------
        REPLACE AREA
        ----------------------------------------------

        IMPORTANT:

        Karena pdf-lib tidak membaca text existing,
        area template perlu ditentukan dengan koordinat.

        Koordinat di bawah adalah contoh awal.

        Nanti kita sesuaikan dengan PDF asli.
        ----------------------------------------------
        */

        drawTemplateValues(
          page,
          font,
          values,
          pageIndex
        );

        /*
        ----------------------------------------------
        TTD + STEMPEL
        ----------------------------------------------
        */

        if (
          ttdImage ||
          stempelImage
        ) {

          placeSignatureBlock(
            page,
            ttdImage,
            stempelImage
          );

        }

        processedPages.push(
          pageIndex + 1
        );

      }

      /*
      ==================================================
      SAVE
      ==================================================
      */

      console.log(
        "STEP 10 - Saving PDF"
      );

      const outputBytes =
        await pdfDoc.save();

      console.log(
        "STEP 11 - Output bytes:",
        outputBytes.length
      );

      const outputBase64 =
        uint8ArrayToBase64(
          outputBytes
        );

      /*
      ==================================================
      RESPONSE
      ==================================================
      */

      return jsonResponse({

        success: true,

        template,

        fileName:
          template === "prekursor"
            ? "hasil_prekursor.pdf"
            : "hasil_reguler.pdf",

        contentType:
          "application/pdf",

        pdfBase64:
          outputBase64,

        debug: {

          pageCount:
            pages.length,

          processedPages,

          prekursor:

            template === "prekursor"
              ? prekursor
              : null

        }

      });

    } catch (error) {

      console.error(
        "WORKER ERROR:",
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
======================================================
DRAW TEMPLATE VALUES
======================================================

CATATAN:

Ini adalah bagian yang akan kita sesuaikan dengan
koordinat template PDF Anda.

pdf-lib menggunakan:

x = dari kiri
y = dari bawah

======================================================
*/

function drawTemplateValues(
  page,
  font,
  values,
  pageIndex
) {

  /*
  ====================================================
  CONTOH:

  Jangan digunakan sebagai posisi final sebelum
  dicocokkan dengan PDF Anda.
  ====================================================
  */

  /*
  Contoh sementara:

  page.drawText(
    values.Satu,
    {
      x: 100,
      y: 700,
      size: 9,
      font
    }
  );
  */

  /*
  Untuk sementara kita TIDAK menggambar
  Satu-Duabelas agar tidak merusak template.

  Setelah posisi field ditentukan, bagian ini
  akan diisi koordinat final.
  */

}


/*
======================================================
TTD + STEMPEL
======================================================

SEMUA HALAMAN

TTD + Stempel dianggap satu blok.

======================================================
*/

function placeSignatureBlock(
  page,
  ttdImage,
  stempelImage
) {

  /*
  ====================================================
  POSISI DASAR
  ====================================================

  Ini menggunakan posisi yang sudah kita bahas:

  TTD + Stempel dinaikkan sekitar 1 cm dari posisi
  sebelumnya.

  Nanti kita sesuaikan dengan PDF final.
  ====================================================
  */

  const baseX = 400;
  const baseY = 80;


  /*
  ====================================================
  TTD
  ====================================================
  */

  if (ttdImage) {

    const ttdWidth = 100;

    const ttdHeight =
      imageHeight(
        ttdImage,
        ttdWidth
      );

    page.drawImage(
      ttdImage,
      {
        x: baseX,
        y: baseY,
        width: ttdWidth,
        height: ttdHeight
      }
    );
  }


  /*
  ====================================================
  STEMPEL
  ====================================================
  */

  if (stempelImage) {

    const stempelWidth = 65;

    const stempelHeight =
      imageHeight(
        stempelImage,
        stempelWidth
      );

    page.drawImage(
      stempelImage,
      {
        x: baseX + 60,
        y: baseY - 8,
        width: stempelWidth,
        height: stempelHeight
      }
    );
  }

}


/*
======================================================
PREKURSOR CSV
======================================================
*/

async function lookupPrekursor(
  productSku
) {

  const response =
    await fetch(
      MASTER_PREKURSOR_CSV_URL
    );

  if (!response.ok) {

    throw new Error(
      `Gagal mengambil master_prekursor.csv. HTTP ${response.status}`
    );

  }

  const csvText =
    await response.text();

  const rows =
    parseCSV(csvText);

  if (rows.length < 2) {

    throw new Error(
      "master_prekursor.csv kosong."
    );

  }

  const headers =
    rows[0].map(
      normalizeHeader
    );

  const skuIndex =
    findColumn(
      headers,
      [
        "product sku",
        "productsku",
        "sku"
      ]
    );

  const zatAktifIndex =
    findColumn(
      headers,
      [
        "zat aktif",
        "zataktif",
        "active ingredient",
        "activeingredient"
      ]
    );

  const bentukIndex =
    findColumn(
      headers,
      [
        "bentuk",
        "form",
        "dosage form",
        "dosageform"
      ]
    );

  if (skuIndex === -1) {

    throw new Error(
      "Kolom Product SKU tidak ditemukan."
    );

  }

  for (
    let i = 1;
    i < rows.length;
    i++
  ) {

    const sku =
      cleanSku(
        rows[i][skuIndex]
      );

    if (
      sku === cleanSku(productSku)
    ) {

      return {

        found: true,

        productSku:
          rows[i][skuIndex] || "",

        zatAktif:
          zatAktifIndex >= 0
            ? rows[i][zatAktifIndex] || ""
            : "",

        bentuk:
          bentukIndex >= 0
            ? rows[i][bentukIndex] || ""
            : ""

      };

    }

  }

  return {

    found: false,

    productSku,

    zatAktif: "",

    bentuk: ""

  };

}


/*
======================================================
CSV PARSER
======================================================
*/

function parseCSV(text) {

  const rows = [];

  let row = [];

  let field = "";

  let quoted = false;

  for (
    let i = 0;
    i < text.length;
    i++
  ) {

    const char =
      text[i];

    const next =
      text[i + 1];

    if (
      char === '"' &&
      quoted &&
      next === '"'
    ) {

      field += '"';

      i++;

      continue;
    }

    if (
      char === '"'
    ) {

      quoted =
        !quoted;

      continue;
    }

    if (
      char === "," &&
      !quoted
    ) {

      row.push(field);

      field = "";

      continue;
    }

    if (
      (char === "\n" ||
       char === "\r") &&
      !quoted
    ) {

      if (
        char === "\r" &&
        next === "\n"
      ) {

        i++;
      }

      row.push(field);

      rows.push(row);

      row = [];

      field = "";

      continue;
    }

    field += char;
  }

  if (
    field ||
    row.length
  ) {

    row.push(field);

    rows.push(row);
  }

  return rows;
}


/*
======================================================
COLUMN
======================================================
*/

function findColumn(
  headers,
  names
) {

  for (
    const name of names
  ) {

    const index =
      headers.indexOf(name);

    if (
      index !== -1
    ) {

      return index;
    }
  }

  return -1;
}


/*
======================================================
NORMALIZE HEADER
======================================================
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
======================================================
SKU
======================================================
*/

function cleanSku(
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
    );

}


/*
======================================================
TEMPLATE
======================================================
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
======================================================
IMAGE
======================================================
*/

async function embedImage(
  pdfDoc,
  bytes
) {

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {

    return await pdfDoc.embedPng(
      bytes
    );

  }

  if (
    bytes.length >= 2 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8
  ) {

    return await pdfDoc.embedJpg(
      bytes
    );

  }

  throw new Error(
    "TTD/Stempel harus PNG atau JPEG."
  );

}


/*
======================================================
IMAGE HEIGHT
======================================================
*/

function imageHeight(
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
======================================================
BASE64 CLEAN
======================================================
*/

function cleanBase64(
  value
) {

  let text =
    String(
      value || ""
    );

  const match =
    text.match(
      /base64,([^"'<>]+)/i
    );

  if (
    match
  ) {

    text =
      match[1];
  }

  text =
    text.replace(
      /^data:[^;]+;base64,/i,
      ""
    );

  text =
    text.replace(
      /\s/g,
      ""
    );

  return text;
}


/*
======================================================
BASE64 → UINT8
======================================================
*/

function base64ToUint8Array(
  base64
) {

  const binary =
    atob(base64);

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
======================================================
UINT8 → BASE64
======================================================
*/

function uint8ArrayToBase64(
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


/*
======================================================
SAFE STRING
======================================================
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

  return String(value);
}


/*
======================================================
JSON RESPONSE
======================================================
*/

function jsonResponse(
  data,
  status = 200
) {

  return new Response(
    JSON.stringify(data),
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


/*
======================================================
CORS
======================================================
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
