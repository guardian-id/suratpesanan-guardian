import {
  PDFDocument,
  StandardFonts,
  rgb
} from "pdf-lib";

import { getDocument } from "pdfjs-serverless";


// ==========================================================
// GITHUB
// ==========================================================

const GITHUB_BASE =
  "https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main";

const REGULER_URL =
  `${GITHUB_BASE}/Reguler.pdf`;

const PREKURSOR_URL =
  `${GITHUB_BASE}/Prekursor.pdf`;

const MASTER_URL =
  `${GITHUB_BASE}/master_prekursor.csv`;


// ==========================================================
// PLACEHOLDERS
// ==========================================================

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


// ==========================================================
// WORKER
// ==========================================================

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


      const template =
        String(
          body.template || "Reguler"
        )
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


      // ====================================================
      // DOWNLOAD TEMPLATE
      // ====================================================

      const templateUrl =
        template === "prekursor"
          ? PREKURSOR_URL
          : REGULER_URL;


      const templateBytes =
        await downloadBytes(
          templateUrl
        );


      validatePdf(
        templateBytes,
        "Template"
      );


      // ====================================================
      // PDF UPLOAD
      // ====================================================

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
        "PDF upload"
      );


      // ====================================================
      // LOAD PDF UPLOAD
      // ====================================================

      const uploadedPdf =
        await PDFDocument.load(
          uploadedBytes
        );


      const uploadPageCount =
        uploadedPdf.getPageCount();


      if (
        uploadPageCount < 1
      ) {

        throw new Error(
          "PDF upload tidak memiliki halaman."
        );

      }


      // ====================================================
      // LOAD TEMPLATE
      // ====================================================

      const templatePdf =
        await PDFDocument.load(
          templateBytes
        );


      const templatePage =
        templatePdf.getPage(0);


      const templateWidth =
        templatePage.getWidth();


      const templateHeight =
        templatePage.getHeight();


      // ====================================================
      // PDF.JS
      // ====================================================

      const pdfjs =
        await getPdfJs();


      const templateTextDocument =
        await pdfjs.getDocument({
          data:
            new Uint8Array(
              templateBytes
            ),
          useSystemFonts: true
        }).promise;


      const uploadTextDocument =
        await pdfjs.getDocument({
          data:
            new Uint8Array(
              uploadedBytes
            ),
          useSystemFonts: true
        }).promise;


      // ====================================================
      // CREATE OUTPUT
      // ====================================================

      const outputPdf =
        await PDFDocument.create();


      // ====================================================
      // FONT
      // ====================================================

      const font =
        await outputPdf.embedFont(
          StandardFonts.Helvetica
        );


      // ====================================================
      // DATA
      // ====================================================

      const data = {};

      for (
        const key of PLACEHOLDERS
      ) {

        data[key] =
          body[key] === undefined ||
          body[key] === null
            ? ""
            : String(body[key]);

      }


      // ====================================================
      // PREKURSOR LOOKUP
      // ====================================================

      let lookupInfo = null;


      if (
        template === "prekursor"
      ) {

        const uploadText =
          await extractPdfTextFromDocument(
            uploadTextDocument
          );


        const skuList =
          extractProductSKUs(
            uploadText
          );


        if (
          skuList.length === 0
        ) {

          throw new Error(
            "Product SKU tidak ditemukan pada PDF upload."
          );

        }


        const csv =
          await downloadText(
            MASTER_URL
          );


        const master =
          parseCSV(csv);


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
            `SKU tidak ditemukan di master_prekursor.csv. SKU: ${skuList.join(", ")}`
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
          productSKU:
            foundSKU,

          zatAktif,

          bentuk
        };

      }


      // ====================================================
      // BUAT HALAMAN SESUAI PDF UPLOAD
      // ====================================================

      for (
        let pageIndex = 0;
        pageIndex < uploadPageCount;
        pageIndex++
      ) {

        // -----------------------------------------------
        // COPY TEMPLATE PAGE
        // -----------------------------------------------

        const copiedTemplatePages =
          await outputPdf.copyPages(
            templatePdf,
            [0]
          );


        const page =
          copiedTemplatePages[0];


        outputPdf.addPage(
          page
        );


        // -----------------------------------------------
        // TEMPLATE TEXT
        // -----------------------------------------------

        const templatePageJs =
          await templateTextDocument.getPage(
            1
          );


        const templateContent =
          await templatePageJs.getTextContent();


        const templateItems =
          templateContent.items || [];


        // -----------------------------------------------
        // REPLACE Satu-Duabelas
        // -----------------------------------------------

        for (
          const key of Object.keys(data)
        ) {

          const value =
            String(
              data[key] ?? ""
            );


          const matches =
            findText(
              templateItems,
              key
            );


          for (
            const match of matches
          ) {

            if (
              !match.transform
            ) {
              continue;
            }


            const x =
              match.transform[4];


            const y =
              match.transform[5];


            const fontSize =
              Math.max(
                6,
                Math.abs(
                  match.transform[3] || 10
                )
              );


            const width =
              Math.max(
                match.width || 0,
                key.length *
                  fontSize *
                  0.5
              );


            // tutup placeholder
            page.drawRectangle({

              x:
                x - 2,

              y:
                y - fontSize - 3,

              width:
                width + 5,

              height:
                fontSize + 7,

              color:
                rgb(
                  1,
                  1,
                  1
                )

            });


            if (
              value.trim() === ""
            ) {
              continue;
            }


            // tulis value
            page.drawText(
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
                  )

              }
            );

          }

        }


        // =================================================
        // AMBIL TABEL DARI PDF UPLOAD
        // =================================================

        const uploadPage =
          await uploadTextDocument.getPage(
            pageIndex + 1
          );


        const uploadContent =
          await uploadPage.getTextContent();


        const uploadItems =
          uploadContent.items || [];


        // =================================================
        // CARI HEADER TABLE
        // =================================================

        const tableHeader =
          findTableHeader(
            uploadItems
          );


        if (
          tableHeader
        ) {

          // ---------------------------------------------
          // BOUNDING BOX TABEL
          // ---------------------------------------------

          const tableBox =
            detectTableBox(
              uploadItems,
              tableHeader
            );


          if (
            tableBox
          ) {

            // -------------------------------------------
            // EMBED HALAMAN PDF UPLOAD
            // DENGAN CLIP AREA TABEL
            // -------------------------------------------

            const embedded =
              await outputPdf.embedPage(
                uploadedPdf.getPage(
                  pageIndex
                ),
                {
                  left:
                    tableBox.left,

                  bottom:
                    tableBox.bottom,

                  right:
                    tableBox.right,

                  top:
                    tableBox.top
                }
              );


            // -------------------------------------------
            // AREA TARGET TABLE
            //
            // Untuk tahap awal kita gunakan area yang
            // sama dengan area tabel upload.
            // -------------------------------------------

            const targetWidth =
              tableBox.right -
              tableBox.left;


            const targetHeight =
              tableBox.top -
              tableBox.bottom;


            page.drawRectangle({

              x:
                tableBox.left,

              y:
                tableBox.bottom,

              width:
                targetWidth,

              height:
                targetHeight,

              color:
                rgb(
                  1,
                  1,
                  1
                )

            });


            page.drawPage(
              embedded,
              {

                x:
                  tableBox.left,

                y:
                  tableBox.bottom,

                width:
                  targetWidth,

                height:
                  targetHeight

              }
            );

          }

        }


        // =================================================
        // TTD + STEMPEL
        // =================================================

        await drawSignatureStamp(
          page,
          templateItems,
          outputPdf,
          body.ttdBase64 || "",
          body.stempelBase64 || ""
        );

      }


      // ====================================================
      // CLEANUP
      // ====================================================

      try {
        await templateTextDocument.destroy();
      } catch (_) {}


      try {
        await uploadTextDocument.destroy();
      } catch (_) {}


      // ====================================================
      // SAVE
      // ====================================================

      const outputBytes =
        await outputPdf.save();


      const outputBase64 =
        bytesToBase64(
          outputBytes
        );


      const result = {

        success:
          true,

        message:
          "PDF berhasil diproses.",

        template:
          template === "prekursor"
            ? "Prekursor"
            : "Reguler",

        inputPages:
          uploadPageCount,

        outputPages:
          outputPdf.getPageCount(),

        spBase64:
          outputBase64

      };


      if (
        lookupInfo
      ) {

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

    }

    catch (error) {

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


// ==========================================================
// TABLE HEADER
// ==========================================================

function findTableHeader(
  items
) {

  const keywords = [
    "Product SKU",
    "ProductSKU",
    "SKU",
    "Product",
    "Description"
  ];


  for (
    const keyword of keywords
  ) {

    const matches =
      findText(
        items,
        keyword
      );


    if (
      matches.length
    ) {

      return matches[0];

    }

  }


  return null;

}


// ==========================================================
// TABLE BOUNDING BOX
// ==========================================================

function detectTableBox(
  items,
  header
) {

  if (
    !header ||
    !header.transform
  ) {

    return null;

  }


  const headerX =
    header.transform[4] || 0;


  const headerY =
    header.transform[5] || 0;


  let minX =
    headerX - 5;


  let maxX =
    headerX +
    Math.max(
      header.width || 0,
      100
    );


  let minY =
    headerY - 250;


  let maxY =
    headerY + 30;


  for (
    const item of items
  ) {

    if (
      !item.transform ||
      typeof item.str !== "string"
    ) {
      continue;
    }


    const x =
      item.transform[4] || 0;


    const y =
      item.transform[5] || 0;


    const width =
      item.width || 0;


    minX =
      Math.min(
        minX,
        x
      );


    maxX =
      Math.max(
        maxX,
        x + width
      );


    minY =
      Math.min(
        minY,
        y
      );


    maxY =
      Math.max(
        maxY,
        y
      );

  }


  // Jangan terlalu besar
  minX =
    Math.max(
      0,
      minX
    );


  minY =
    Math.max(
      0,
      minY
    );


  return {

    left:
      minX,

    bottom:
      minY,

    right:
      maxX,

    top:
      maxY

  };

}


// ==========================================================
// SIGNATURE + STAMP
// ==========================================================

async function drawSignatureStamp(
  page,
  items,
  pdf,
  ttdInput,
  stampInput
) {

  let ttdImage = null;
  let stampImage = null;


  // --------------------------------------------------------
  // TTD
  // --------------------------------------------------------

  if (
    ttdInput
  ) {

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


  // --------------------------------------------------------
  // STEMPEL
  // --------------------------------------------------------

  if (
    stampInput
  ) {

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


  // --------------------------------------------------------
  // TTD
  // --------------------------------------------------------

  if (
    ttdImage
  ) {

    const matches =
      findText(
        items,
        "TTD"
      );


    if (
      matches.length
    ) {

      const m =
        matches[0];


      const x =
        m.transform[4];


      const y =
        m.transform[5];


      // hapus keyword
      page.drawRectangle({

        x:
          x - 5,

        y:
          y - 15,

        width:
          50,

        height:
          25,

        color:
          rgb(
            1,
            1,
            1
          )

      });


      page.drawImage(
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


  // --------------------------------------------------------
  // STEMPEL
  // --------------------------------------------------------

  if (
    stampImage
  ) {

    const matches =
      findText(
        items,
        "Stempel"
      );


    if (
      matches.length
    ) {

      const m =
        matches[0];


      const x =
        m.transform[4];


      const y =
        m.transform[5];


      page.drawRectangle({

        x:
          x - 5,

        y:
          y - 15,

        width:
          70,

        height:
          25,

        color:
          rgb(
            1,
            1,
            1
          )

      });


      page.drawImage(
        stampImage,
        {

          x:
            x - 5,

          y:
            y - 45,

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


// ==========================================================
// FIND TEXT
// ==========================================================

function findText(
  items,
  target
) {

  const result = [];


  for (
    let i = 0;
    i < items.length;
    i++
  ) {

    const item =
      items[i];


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


  // --------------------------------------------------------
  // text terpecah
  // --------------------------------------------------------

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
    result
  );

}


// ==========================================================
// WIDTH
// ==========================================================

function combinedWidth(
  first,
  last
) {

  const x1 =
    first?.transform?.[4] || 0;


  const x2 =
    last?.transform?.[4] || 0;


  return (
    Math.abs(
      x2 - x1
    ) +
    (last?.width || 0)
  );

}


// ==========================================================
// DUPLICATE
// ==========================================================

function removeDuplicates(
  items
) {

  const result = [];
  const seen = new Set();


  for (
    const item of items
  ) {

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

    result.push(
      item
    );

  }


  return result;

}


// ==========================================================
// PDF TEXT
// ==========================================================

async function extractPdfTextFromDocument(
  document
) {

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


  return pages.join("\n");

}


// ==========================================================
// PDF.JS
// ==========================================================

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


// ==========================================================
// SKU
// ==========================================================

function extractProductSKUs(
  text
) {

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


  const result = [];


  for (
    const pattern of patterns
  ) {

    const match =
      normalized.match(
        pattern
      );


    if (
      match?.[1]
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
      result
    )
  ];

}


// ==========================================================
// CSV
// ==========================================================

function parseCSV(
  text
) {

  const lines =
    String(
      text || ""
    )
      .replace(
        /^\uFEFF/,
        ""
      )
      .split(/\r?\n/)
      .filter(
        x =>
          x.trim() !== ""
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


// ==========================================================
// CSV LINE
// ==========================================================

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


// ==========================================================
// FIND SKU
// ==========================================================

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


// ==========================================================
// NORMALIZE SKU
// ==========================================================

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


// ==========================================================
// FIRST VALUE
// ==========================================================

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


// ==========================================================
// DOWNLOAD BYTES
// ==========================================================

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
      `Gagal mengambil file GitHub: HTTP ${response.status}`
    );

  }


  return new Uint8Array(
    await response.arrayBuffer()
  );

}


// ==========================================================
// DOWNLOAD TEXT
// ==========================================================

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


  return response.text();

}


// ==========================================================
// IMAGE BASE64
// ==========================================================

function extractImageBase64(
  input
) {

  let value =
    String(
      input || ""
    ).trim();


  const match =
    value.match(
      /<img[^>]+src=["']data:image\/[^;]+;base64,([^"']+)["']/i
    );


  if (
    match?.[1]
  ) {

    return match[1];

  }


  if (
    value.startsWith("data:")
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


  return value;

}


// ==========================================================
// BASE64
// ==========================================================

function base64ToBytes(
  input
) {

  let value =
    extractImageBase64(
      input
    );


  value =
    value.replace(
      /\s/g,
      ""
    );


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


// ==========================================================
// BYTES → BASE64
// ==========================================================

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


// ==========================================================
// JPG
// ==========================================================

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


// ==========================================================
// PDF VALIDATION
// ==========================================================

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


// ==========================================================
// JSON
// ==========================================================

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
