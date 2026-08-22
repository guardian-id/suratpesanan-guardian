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
SURAT PESANAN GUARDIAN
CLOUDFLARE WORKER
=========================================================

INPUT:

{
  "template": "Reguler",

  "pdfBase64": "...",

  "ttdBase64": "<img src=\"data:image/png;base64,...\">",

  "stempelBase64": "<img src=\"data:image/png;base64,...\">",

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


OUTPUT:

{
  "success": true,
  "template": "prekursor",
  "pdfBase64": "JVBERi0...",
  "fileName": "hasil_prekursor.pdf"
}


=========================================================
PREKURSOR
=========================================================

Jika template = Prekursor:

1. Baca semua text dari PDF.
2. Cari Product SKU.
3. Cocokkan dengan master_prekursor.csv.
4. Ambil:
      - Zat Aktif
      - Bentuk
5. Tempel hasilnya ke PDF.


=========================================================
TTD + STEMPEL
=========================================================

Cari keyword:

TTD
Stempel

Kemudian gambar TTD + Stempel sebagai satu blok
visual.


=========================================================
*/


/*
=========================================================
GITHUB
=========================================================

GANTI URL INI DENGAN RAW URL CSV ANDA.

Contoh:

https://raw.githubusercontent.com/username/repository/main/master_prekursor.csv

=========================================================
*/

const MASTER_PREKURSOR_CSV_URL =
  "https://raw.githubusercontent.com/USERNAME/REPOSITORY/main/master_prekursor.csv";


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
    =====================================================
    CORS
    =====================================================
    */

    if (request.method === "OPTIONS") {

      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });

    }


    /*
    =====================================================
    ONLY POST
    =====================================================
    */

    if (request.method !== "POST") {

      return jsonResponse({

        success: false,

        message:
          "Gunakan method POST."

      }, 405);

    }


    /*
    =====================================================
    MAIN TRY
    =====================================================
    */

    try {

      /*
      ---------------------------------------------------
      1. READ JSON
      ---------------------------------------------------
      */

      const body =
        await request.json();


      /*
      ---------------------------------------------------
      2. TEMPLATE
      ---------------------------------------------------
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
            "Template harus Reguler atau Prekursor.",

          receivedTemplate:
            body.template || null

        }, 400);

      }


      /*
      ---------------------------------------------------
      3. PDF BASE64
      ---------------------------------------------------
      */

      if (
        !body.pdfBase64
      ) {

        return jsonResponse({

          success: false,

          message:
            "pdfBase64 tidak ditemukan."

        }, 400);

      }


      /*
      ===================================================
      4. CLEAN PDF BASE64
      ===================================================
      */

      const cleanPdfBase64 =
        cleanBase64(
          body.pdfBase64
        );


      /*
      ===================================================
      5. DECODE PDF
      ===================================================
      */

      const pdfBytes =
        base64ToUint8Array(
          cleanPdfBase64
        );


      /*
      ===================================================
      6. VALIDATE PDF
      ===================================================
      */

      if (
        pdfBytes.length < 5
      ) {

        throw new Error(
          "PDF terlalu kecil atau kosong."
        );

      }


      /*
      PDF harus diawali %PDF
      */

      const pdfHeader =
        String.fromCharCode(
          pdfBytes[0],
          pdfBytes[1],
          pdfBytes[2],
          pdfBytes[3]
        );


      if (
        pdfHeader !== "%PDF"
      ) {

        throw new Error(
          "pdfBase64 bukan file PDF yang valid."
        );

      }


      /*
      ===================================================
      7. LOAD PDF-LIB
      ===================================================
      */

      const pdfDoc =
        await PDFDocument.load(
          pdfBytes
        );


      /*
      ===================================================
      8. LOAD PDF.JS
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
      9. FONT
      ===================================================
      */

      const font =
        await pdfDoc.embedFont(
          StandardFonts.Helvetica
        );


      /*
      ===================================================
      10. POWER AUTOMATE VALUES
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
      11. GET ALL PDF TEXT
      ===================================================
      */

      const allPagesText =
        [];


      const pageCount =
        pdfDoc.getPageCount();


      for (
        let pageIndex = 0;
        pageIndex < pageCount;
        pageIndex++
      ) {

        const pdfJsPage =
          await pdfJsDocument.getPage(
            pageIndex + 1
          );


        const textContent =
          await pdfJsPage.getTextContent();


        const items =
          textContent.items
            .filter(
              item =>
                typeof item.str === "string" &&
                item.str.trim() !== ""
            );


        allPagesText.push(
          items
        );

      }


      /*
      ===================================================
      12. PREKURSOR LOOKUP
      ===================================================
      */

      let prekursorData =
        null;


      let detectedProductSku =
        null;


      if (
        template === "prekursor"
      ) {

        /*
        -----------------------------------------------
        Cari SKU dari PDF
        -----------------------------------------------
        */

        detectedProductSku =
          detectProductSku(
            allPagesText
          );


        /*
        -----------------------------------------------
        Jika SKU tidak ditemukan di PDF,
        fallback ke Satu.
        -----------------------------------------------
        */

        if (
          !detectedProductSku &&
          values.Satu
        ) {

          detectedProductSku =
            extractSkuFromText(
              values.Satu
            );

        }


        /*
        -----------------------------------------------
        Lookup CSV
        -----------------------------------------------
        */

        if (
          detectedProductSku
        ) {

          prekursorData =
            await lookupPrekursor(
              detectedProductSku
            );

        }

      }


      /*
      ===================================================
      13. PROCESS PDF PAGES
      ===================================================
      */

      const pages =
        pdfDoc.getPages();


      let replacedPlaceholders =
        [];


      let signaturePages =
        [];


      for (
        let pageIndex = 0;
        pageIndex < pageCount;
        pageIndex++
      ) {

        const page =
          pages[pageIndex];


        const textItems =
          allPagesText[pageIndex];


        /*
        =================================================
        A. PLACEHOLDER SATU - DUABELAS
        =================================================
        */

        for (
          const placeholder of PLACEHOLDERS
        ) {

          const value =
            values[placeholder];


          /*
          Empty → skip
          */

          if (
            !value
          ) {

            continue;

          }


          /*
          Cari placeholder
          */

          const location =
            findTextLocation(

              textItems,

              placeholder,

              page.getHeight()

            );


          if (
            !location
          ) {

            continue;

          }


          /*
          Tutup placeholder lama
          */

          coverText(
            page,
            location,
            2
          );


          /*
          Gambar nilai baru
          */

          drawReplacementText(

            page,

            font,

            value,

            location

          );


          replacedPlaceholders.push({

            page:
              pageIndex + 1,

            placeholder,

            value

          });

        }


        /*
        =================================================
        B. PREKURSOR
        =================================================
        */

        if (
          template === "prekursor" &&
          prekursorData &&
          prekursorData.found
        ) {

          /*
          ---------------------------------------------
          ZAT AKTIF
          ---------------------------------------------
          */

          if (
            prekursorData.zatAktif
          ) {

            const replaced =
              replaceKeywordValue({

                page,

                textItems,

                keyword:
                  "Zat Aktif",

                value:
                  prekursorData.zatAktif,

                font

              });


            if (
              replaced
            ) {

              replacedPlaceholders.push({

                page:
                  pageIndex + 1,

                placeholder:
                  "Zat Aktif",

                value:
                  prekursorData.zatAktif

              });

            }

          }


          /*
          ---------------------------------------------
          BENTUK
          ---------------------------------------------
          */

          if (
            prekursorData.bentuk
          ) {

            const replaced =
              replaceKeywordValue({

                page,

                textItems,

                keyword:
                  "Bentuk",

                value:
                  prekursorData.bentuk,

                font

              });


            if (
              replaced
            ) {

              replacedPlaceholders.push({

                page:
                  pageIndex + 1,

                placeholder:
                  "Bentuk",

                value:
                  prekursorData.bentuk

              });

            }

          }

        }


        /*
        =================================================
        C. TTD + STEMPEL
        =================================================
        */

        if (
          body.ttdBase64 ||
          body.stempelBase64
        ) {

          const signatureResult =
            await placeSignatureBlock({

              pdfDoc,

              page,

              textItems,

              ttdBase64:
                body.ttdBase64,

              stempelBase64:
                body.stempelBase64

            });


          if (
            signatureResult.placed
          ) {

            signaturePages.push(
              pageIndex + 1
            );

          }

        }

      }


      /*
      ===================================================
      14. SAVE PDF
      ===================================================
      */

      const outputBytes =
        await pdfDoc.save();


      /*
      ===================================================
      15. OUTPUT BASE64
      ===================================================
      */

      const outputBase64 =
        uint8ArrayToBase64(
          outputBytes
        );


      /*
      ===================================================
      16. FILE NAME
      ===================================================
      */

      const fileName =
        template === "prekursor"
          ? "hasil_prekursor.pdf"
          : "hasil_reguler.pdf";


      /*
      ===================================================
      17. RESPONSE
      ===================================================
      */

      return jsonResponse({

        success:
          true,

        template,

        fileName,

        contentType:
          "application/pdf",

        pdfBase64:
          outputBase64,

        /*
        -----------------------------------------------
        DEBUG INFORMATION
        -----------------------------------------------
        */

        debug: {

          pageCount,

          replacedPlaceholders,

          signaturePages,

          detectedProductSku,

          prekursorLookup:
            prekursorData

        }

      });

    }


    /*
    =====================================================
    ERROR
    =====================================================
    */

    catch (error) {

      console.error(
        "WORKER ERROR:",
        error
      );


      return jsonResponse({

        success:
          false,

        message:
          error?.message ||
          "Terjadi error pada Worker.",

        error:
          String(error)

      }, 500);

    }

  }

};


/*
=========================================================
DETECT PRODUCT SKU
=========================================================

Mencari Product SKU dari seluruh text PDF.

Contoh:

3039929
1234567
7654321

Kemudian nanti dicocokkan dengan CSV.

Untuk menghindari angka seperti tanggal,
nomor halaman, quantity, dll,
kita prioritaskan angka 5-12 digit.

=========================================================
*/

function detectProductSku(
  allPagesText
) {

  /*
  Gabungkan semua text PDF
  */

  const allText =
    allPagesText
      .flat()
      .map(
        item =>
          item.str
      )
      .join(" ");


  /*
  Cari kandidat angka.
  */

  const candidates =
    allText.match(
      /\b\d{5,12}\b/g
    ) || [];


  /*
  Hapus duplicate.
  */

  const unique =
    [
      ...new Set(
        candidates
      )
    ];


  /*
  Prioritas:

  1. SKU yang terlihat sebagai
     Product SKU / SKU
  */

  const skuContext =
    findSkuNearKeyword(
      allPagesText
    );


  if (
    skuContext
  ) {

    return skuContext;

  }


  /*
  Fallback kandidat pertama.
  */

  if (
    unique.length > 0
  ) {

    return unique[0];

  }


  return null;

}


/*
=========================================================
FIND SKU NEAR KEYWORD
=========================================================
*/

function findSkuNearKeyword(
  allPagesText
) {

  const keywords = [

    "product sku",

    "productsku",

    "sku"

  ];


  for (
    const pageItems of allPagesText
  ) {

    for (
      let i = 0;
      i < pageItems.length;
      i++
    ) {

      const current =
        normalizeText(
          pageItems[i].str
        );


      /*
      -----------------------------------------------
      Kalau item adalah SKU keyword
      -----------------------------------------------
      */

      const isSkuKeyword =
        keywords.some(
          keyword =>
            current === keyword ||
            current.includes(keyword)
        );


      if (
        !isSkuKeyword
      ) {

        continue;

      }


      /*
      -----------------------------------------------
      Cari angka di item berikutnya
      -----------------------------------------------
      */

      for (
        let j = i + 1;
        j < Math.min(
          i + 6,
          pageItems.length
        );
        j++
      ) {

        const value =
          extractSkuFromText(
            pageItems[j].str
          );


        if (
          value
        ) {

          return value;

        }

      }

    }

  }


  return null;

}


/*
=========================================================
EXTRACT SKU FROM TEXT
=========================================================
*/

function extractSkuFromText(
  text
) {

  const match =
    String(
      text || ""
    ).match(
      /\b\d{5,12}\b/
    );


  return match
    ? match[0]
    : null;

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
  -----------------------------------------------------
  DOWNLOAD CSV
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
  PARSE
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
      "master_prekursor.csv kosong atau tidak mempunyai data."
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
  COLUMN INDEX
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
  SEARCH
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
  NOT FOUND
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
FIND TEXT LOCATION
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
  =====================================================
  EXACT
  =====================================================
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
  =====================================================
  CONTAINS
  =====================================================
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
  =====================================================
  MULTI-WORD KEYWORD
  =====================================================

  Contoh:

  PDF.js:

  "Zat"
  "Aktif"

  tetapi target:

  "Zat Aktif"
  =====================================================
  */

  const targetWords =
    normalizedTarget
      .split(
        " "
      )
      .filter(
        Boolean
      );


  if (
    targetWords.length > 1
  ) {

    for (
      let i = 0;
      i < textItems.length;
      i++
    ) {

      let combined =
        "";


      for (
        let j = i;
        j < Math.min(
          i + targetWords.length + 2,
          textItems.length
        );
        j++
      ) {

        combined +=
          " " +
          normalizeText(
            textItems[j].str
          );


        if (
          combined
            .trim()
            .includes(
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

  }


  return null;

}


/*
=========================================================
TEXT ITEM LOCATION
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


  const y =
    Number(
      item.transform?.[5] || 0
    );


  const height =
    Math.max(

      Math.abs(
        Number(
          item.transform?.[3] || 0
        )
      ),

      9

    );


  const width =
    Math.max(

      Number(
        item.width || 0
      ),

      10

    );


  return {

    x,

    y,

    width,

    height

  };

}


/*
=========================================================
COVER TEXT
=========================================================
*/

function coverText(
  page,
  location,
  padding = 2
) {

  page.drawRectangle({

    x:
      location.x -
      padding,

    y:
      location.y -
      padding,

    width:
      location.width +
      padding * 2,

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
DRAW REPLACEMENT
=========================================================
*/

function drawReplacementText(
  page,
  font,
  value,
  location
) {

  page.drawText(

    String(
      value
    ),

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
        450,

      lineHeight:
        11

    }

  );

}


/*
=========================================================
REPLACE KEYWORD VALUE
=========================================================
*/

function replaceKeywordValue({

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
  Cover keyword and area after it.
  -----------------------------------------------------
  */

  page.drawRectangle({

    x:
      location.x - 2,

    y:
      location.y - 2,

    width:
      Math.max(
        location.width + 300,
        100
      ),

    height:
      Math.max(
        location.height + 4,
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
  Draw value
  -----------------------------------------------------
  */

  page.drawText(

    String(
      value
    ),

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
TTD + STEMPEL
=========================================================

Keduanya dibuat sebagai satu blok.

Anchor utama:
1. TTD
2. Stempel
3. fallback

Position adjustment:
+28.35 point ≈ +1 cm

Sebelumnya:
+3 cm lalu turun sekitar 2 cm.

Jadi baseline akhir ≈ +1 cm.

Nanti kita fine tune menggunakan PDF asli.
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
  =====================================================
  FIND TTD
  =====================================================
  */

  const ttdLocation =
    findTextLocation(

      textItems,

      "TTD",

      page.getHeight()

    );


  /*
  =====================================================
  FIND STEMPEL
  =====================================================
  */

  const stempelLocation =
    findTextLocation(

      textItems,

      "Stempel",

      page.getHeight()

    );


  /*
  =====================================================
  SELECT ANCHOR
  =====================================================
  */

  let anchor =
    ttdLocation ||
    stempelLocation;


  /*
  =====================================================
  FALLBACK
  =====================================================
  */

  if (
    !anchor
  ) {

    return {

      placed:
        false,

      reason:
        "Keyword TTD/Stempel tidak ditemukan."

    };

  }


  /*
  =====================================================
  POSITION
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
  EMBED TTD
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
  EMBED STEMPEL
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
  TTD
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
  STEMPEL
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


    page.drawImage(

      stempelImage,

      {

        x:
          baseX + 60,

        y:
          baseY - 8,

        width:
          stempelWidth,

        height:
          stempelHeight

      }

    );

  }


  return {

    placed:
      true

  };

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
  PNG
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
  JPEG
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
    "Format gambar TTD/Stempel harus PNG atau JPEG."
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
CLEAN BASE64
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
    String(
      value
    );


  /*
  -----------------------------------------------------
  Jika input:

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
  Jika input:

  data:application/pdf;base64,XXXXX
  -----------------------------------------------------
  */

  text =
    text.replace(

      /^data:[^;]+;base64,/i,

      ""

    );


  /*
  -----------------------------------------------------
  Remove whitespace
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
      "Base64 tidak valid atau rusak."
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

  let binary =
    "";


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
*/

function parseCSV(
  text
) {

  const rows =
    [];


  let row =
    [];


  let field =
    "";


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
    Double quote
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
    Open/close quote
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

      field =
        "";

      continue;

    }


    /*
    New line
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


      row =
        [];


      field =
        "";


      continue;

    }


    field +=
      char;

  }


  /*
  Remaining field
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
FIND COLUMN INDEX
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
