import {
  PDFDocument,
  StandardFonts,
  rgb
} from "pdf-lib";

import { getDocument } from "pdfjs-serverless";

const GITHUB_BASE =
  "https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main";

const REGULER_URL =
  `${GITHUB_BASE}/Reguler.pdf`;

const PREKURSOR_URL =
  `${GITHUB_BASE}/Prekursor.pdf`;

const MASTER_URL =
  `${GITHUB_BASE}/master_prekursor.csv`;

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
 * Placeholder jumlah lembar.
 *
 * Worker akan mencoba mencari salah satu keyword
 * ini pada template.
 */
const PAGE_PLACEHOLDERS = [
  "Jumlah Lembar",
  "jumlah lembar",
  "Jumlah lembar",
  "Lembar",
  "lembar"
];

/*
 * Header yang mungkin ditemukan pada tabel
 * template.
 */
const TABLE_HEADER_HINTS = [
  "Nama Obat",
  "Product SKU",
  "Nama",
  "No",
  "Satuan"
];

/*
 * Header tabel PDF upload.
 */
const UPLOAD_HEADERS = [
  "No",
  "Product SKU",
  "Product Description",
  "Kemasan",
  "Case Pack Qty",
  "Shipping Batch Number",
  "Expired Date",
  "Invoice No"
];


/* =========================================================
 * MAIN WORKER
 * ========================================================= */

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

      const body = await request.json();

      const templateName =
        String(body.template || "")
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

      /*
       * =====================================================
       * TEMPLATE
       * =====================================================
       */

      const templateUrl =
        templateName === "prekursor"
          ? PREKURSOR_URL
          : REGULER_URL;

      const templateBytes =
        await downloadBytes(templateUrl);

      validatePdf(
        templateBytes,
        "Template PDF"
      );

      const pdf =
        await PDFDocument.load(
          templateBytes
        );

      /*
       * =====================================================
       * PDF UPLOAD
       * =====================================================
       */

      if (!body.pdfBase64) {
        throw new Error(
          "pdfBase64 wajib dikirim."
        );
      }

      const uploadedPdfBytes =
        base64ToBytes(
          body.pdfBase64
        );

      validatePdf(
        uploadedPdfBytes,
        "pdfBase64"
      );

      /*
       * Baca PDF upload sekali.
       *
       * Ini dipakai untuk:
       * - jumlah halaman
       * - SKU
       * - tabel
       */

      const uploadedDocument =
        await loadPdfJsDocument(
          uploadedPdfBytes
        );

      const jumlahLembar =
        uploadedDocument.numPages;

      /*
       * =====================================================
       * EXTRACT TEXT PDF UPLOAD
       * =====================================================
       */

      const uploadPages =
        await extractPdfPages(
          uploadedDocument
        );

      /*
       * =====================================================
       * EXTRACT TABLE
       * =====================================================
       */

      const uploadTable =
        extractUploadTable(
          uploadPages
        );

      /*
       * =====================================================
       * SKU
       * =====================================================
       */

      const uploadedText =
        uploadPages
          .map(
            page =>
              page.text
          )
          .join("\n");

      const skuList =
        extractProductSKUs(
          uploadedText
        );

      /*
       * =====================================================
       * DATA JSON
       * =====================================================
       */

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

      /*
       * Jumlah lembar disimpan juga
       * sebagai data internal.
       */

      data.JumlahLembar =
        String(jumlahLembar);

      /*
       * =====================================================
       * PREKURSOR LOOKUP
       * =====================================================
       */

      let lookupInfo = null;

      if (
        templateName === "prekursor"
      ) {
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
            "SKU tidak ditemukan di master_prekursor.csv. " +
            `SKU terbaca: ${skuList.join(", ")}`
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

        lookupInfo = {
          productSKU:
            foundSKU,

          zatAktif,

          bentuk
        };

        data.ZatAktif =
          zatAktif;

        data.Bentuk =
          bentuk;
      }

      /*
       * =====================================================
       * REPLACE SATU - DUABELAS
       * =====================================================
       */

      await replacePlaceholders(
        pdf,
        templateBytes,
        data
      );

      /*
       * =====================================================
       * JUMLAH LEMBAR
       * =====================================================
       */

      await replacePageCount(
        pdf,
        templateBytes,
        jumlahLembar
      );

      /*
       * =====================================================
       * MASUKKAN TABEL
       * =====================================================
       */

      if (
        uploadTable.rows.length > 0
      ) {
        await drawTableIntoTemplate(
          pdf,
          templateBytes,
          uploadTable
        );
      }

      /*
       * =====================================================
       * TTD + STEMPEL
       * =====================================================
       */

      await placeSignatureAndStamp(
        pdf,
        templateBytes,
        body.ttdBase64 || "",
        body.stempelBase64 || ""
      );

      /*
       * =====================================================
       * SAVE
       * =====================================================
       */

      const outputBytes =
        await pdf.save({
          useObjectStreams: false
        });

      const outputBase64 =
        bytesToBase64(
          outputBytes
        );

      const result = {
        success: true,

        message:
          "PDF berhasil diproses.",

        template:
          templateName === "prekursor"
            ? "Prekursor"
            : "Reguler",

        /*
         * INI JUMLAH HALAMAN PDF UPLOAD,
         * BUKAN jumlah halaman template.
         */
        pages:
          jumlahLembar,

        jumlahLembar:
          jumlahLembar,

        tableRows:
          uploadTable.rows.length,

        sku:
          skuList,

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
 * PDF.JS
 * ========================================================= */

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


async function loadPdfJsDocument(
  bytes
) {
  const pdfjs =
    await getPdfJs();

  return pdfjs
    .getDocument({
      data:
        new Uint8Array(
          bytes
        ),
      useSystemFonts: true
    })
    .promise;
}


/* =========================================================
 * EXTRACT PDF PAGES
 * ========================================================= */

async function extractPdfPages(
  document
) {
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

    const items =
      (content.items || [])
        .filter(
          item =>
            typeof item.str === "string" &&
            item.str.trim() !== ""
        )
        .map(
          item => ({
            str:
              String(item.str),

            x:
              Number(
                item.transform?.[4] || 0
              ),

            y:
              Number(
                item.transform?.[5] || 0
              ),

            width:
              Number(
                item.width || 0
              ),

            height:
              Math.abs(
                Number(
                  item.transform?.[3] ||
                  10
                )
              )
          })
        );

    pages.push({
      pageNumber,

      items,

      text:
        items
          .map(
            x =>
              x.str
          )
          .join(" ")
    });
  }

  return pages;
}


/* =========================================================
 * REPLACE PLACEHOLDERS
 * ========================================================= */

async function replacePlaceholders(
  pdf,
  templateBytes,
  data
) {
  const source =
    await loadPdfJsDocument(
      templateBytes
    );

  const font =
    await pdf.embedFont(
      StandardFonts.Helvetica
    );

  const pages =
    pdf.getPages();

  for (
    let pageIndex = 0;
    pageIndex < source.numPages;
    pageIndex++
  ) {
    const sourcePage =
      await source.getPage(
        pageIndex + 1
      );

    const textContent =
      await sourcePage.getTextContent();

    const items =
      (textContent.items || [])
        .filter(
          item =>
            typeof item.str === "string" &&
            item.str.trim() !== ""
        );

    const targetPage =
      pages[pageIndex];

    if (!targetPage) {
      continue;
    }

    /*
     * Setiap key hanya dicari satu kali
     * pada posisi exact.
     */

    const used =
      new Set();

    for (
      const key of PLACEHOLDERS
    ) {
      const value =
        String(
          data[key] ?? ""
        );

      let index =
        items.findIndex(
          item =>
            String(
              item.str
            ).trim() === key
        );

      /*
       * Kalau exact item tidak ditemukan,
       * cari item yang mengandung key.
       */

      if (
        index === -1
      ) {
        index =
          items.findIndex(
            item =>
              String(
                item.str
              ).includes(key)
          );
      }

      if (
        index === -1
      ) {
        continue;
      }

      const item =
        items[index];

      const transform =
        item.transform;

      if (!transform) {
        continue;
      }

      const x =
        Number(
          transform[4] || 0
        );

      const y =
        Number(
          transform[5] || 0
        );

      const fontSize =
        Math.max(
          6,
          Math.abs(
            Number(
              transform[3] || 10
            )
          )
        );

      const width =
        Math.max(
          Number(
            item.width || 0
          ),
          key.length *
            fontSize *
            0.5
        );

      const marker =
        `${pageIndex}:${Math.round(x)}:${Math.round(y)}:${key}`;

      if (
        used.has(marker)
      ) {
        continue;
      }

      used.add(marker);

      /*
       * Tutup placeholder.
       */

      targetPage.drawRectangle({
        x:
          x - 1,

        y:
          y - fontSize - 2,

        width:
          width + 4,

        height:
          fontSize + 5,

        color:
          rgb(
            1,
            1,
            1
          )
      });

      if (
        !value.trim()
      ) {
        continue;
      }

      /*
       * Untuk text panjang,
       * kita pecah berdasarkan panjang.
       */

      const maxChars =
        Math.max(
          20,
          Math.floor(
            80 -
            fontSize
          )
        );

      const lines =
        wrapText(
          value,
          maxChars
        );

      for (
        let lineIndex = 0;
        lineIndex < lines.length;
        lineIndex++
      ) {
        targetPage.drawText(
          lines[lineIndex],
          {
            x,

            y:
              y -
              fontSize +
              1 -
              lineIndex *
                fontSize *
                1.15,

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
  }

  try {
    await source.destroy();
  } catch (_) {}
}


/* =========================================================
 * JUMLAH LEMBAR
 * ========================================================= */

async function replacePageCount(
  pdf,
  templateBytes,
  jumlahLembar
) {
  const source =
    await loadPdfJsDocument(
      templateBytes
    );

  const font =
    await pdf.embedFont(
      StandardFonts.Helvetica
    );

  const pages =
    pdf.getPages();

  for (
    let pageIndex = 0;
    pageIndex < source.numPages;
    pageIndex++
  ) {
    const sourcePage =
      await source.getPage(
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

    let found = null;

    for (
      const item of items
    ) {
      const text =
        String(
          item.str || ""
        ).trim();

      if (
        PAGE_PLACEHOLDERS.includes(
          text
        )
      ) {
        found = item;
        break;
      }
    }

    if (!found) {
      continue;
    }

    const x =
      Number(
        found.transform?.[4] || 0
      );

    const y =
      Number(
        found.transform?.[5] || 0
      );

    const size =
      Math.max(
        7,
        Math.abs(
          Number(
            found.transform?.[3] ||
            10
          )
        )
      );

    targetPage.drawRectangle({
      x:
        x - 2,

      y:
        y - size - 2,

      width:
        Math.max(
          Number(
            found.width || 0
          ),
          80
        ) + 4,

      height:
        size + 6,

      color:
        rgb(
          1,
          1,
          1
        )
    });

    targetPage.drawText(
      String(
        jumlahLembar
      ),
      {
        x,

        y:
          y - size + 1,

        size,

        font,

        color:
          rgb(
            0,
            0,
            0
          )
      }
    );

    break;
  }

  try {
    await source.destroy();
  } catch (_) {}
}


/* =========================================================
 * TABLE EXTRACTION
 * ========================================================= */

function extractUploadTable(
  pages
) {
  const rows = [];

  for (
    const page of pages
  ) {
    const groups =
      groupItemsByY(
        page.items
      );

    let headerIndex = -1;

    for (
      let i = 0;
      i < groups.length;
      i++
    ) {
      const text =
        groups[i]
          .map(
            x =>
              x.str
          )
          .join(" ");

      if (
        /Product\s*SKU/i.test(text) &&
        /Product\s*Description/i.test(text)
      ) {
        headerIndex = i;
        break;
      }
    }

    if (
      headerIndex === -1
    ) {
      continue;
    }

    const header =
      groups[headerIndex];

    const columns =
      detectColumns(
        header
      );

    for (
      let i =
        headerIndex + 1;
      i < groups.length;
      i++
    ) {
      const group =
        groups[i];

      const text =
        group
          .map(
            x =>
              x.str
          )
          .join(" ")
          .trim();

      /*
       * Stop kalau sudah masuk
       * footer / halaman berikut.
       */

      if (
        !text ||
        /^Page\s+\d+/i.test(text)
      ) {
        continue;
      }

      const cells =
        mapItemsToColumns(
          group,
          columns
        );

      if (
        cells.some(
          x =>
            x.trim() !== ""
        )
      ) {
        rows.push(
          cells
        );
      }
    }
  }

  return {
    columns:
      UPLOAD_HEADERS,

    rows
  };
}


/* =========================================================
 * GROUP PDF TEXT BY Y
 * ========================================================= */

function groupItemsByY(
  items
) {
  const sorted =
    [...items]
      .sort(
        (a, b) =>
          b.y - a.y ||
          a.x - b.x
      );

  const groups = [];

  for (
    const item of sorted
  ) {
    let group =
      groups.find(
        g =>
          Math.abs(
            g.y - item.y
          ) <= 3
      );

    if (!group) {
      group = {
        y:
          item.y,

        items: []
      };

      groups.push(
        group
      );
    }

    group.items.push(
      item
    );
  }

  return groups
    .sort(
      (a, b) =>
        b.y - a.y
    )
    .map(
      g =>
        g.items.sort(
          (a, b) =>
            a.x - b.x
        )
    );
}


/* =========================================================
 * DETECT COLUMNS
 * ========================================================= */

function detectColumns(
  headerItems
) {
  const result = [];

  for (
    const header of UPLOAD_HEADERS
  ) {
    const words =
      header
        .toLowerCase()
        .split(/\s+/);

    let found =
      headerItems.find(
        item =>
          item.str
            .toLowerCase()
            .includes(
              words[0]
            )
      );

    if (!found) {
      found =
        headerItems.find(
          item =>
            words.some(
              word =>
                item.str
                  .toLowerCase()
                  .includes(
                    word
                  )
            )
        );
    }

    result.push({
      name:
        header,

      x:
        found
          ? found.x
          : result.length *
            60
    });
  }

  return result;
}


/* =========================================================
 * MAP ITEMS → COLUMNS
 * ========================================================= */

function mapItemsToColumns(
  items,
  columns
) {
  const cells =
    columns.map(
      () => []
    );

  for (
    const item of items
  ) {
    let bestIndex = 0;
    let bestDistance =
      Infinity;

    for (
      let i = 0;
      i < columns.length;
      i++
    ) {
      const distance =
        Math.abs(
          item.x -
          columns[i].x
        );

      if (
        distance <
        bestDistance
      ) {
        bestDistance =
          distance;

        bestIndex =
          i;
      }
    }

    cells[
      bestIndex
    ].push(
      item.str
    );
  }

  return cells.map(
    cell =>
      cell
        .join(" ")
        .trim()
  );
}


/* =========================================================
 * DRAW TABLE
 * ========================================================= */

async function drawTableIntoTemplate(
  pdf,
  templateBytes,
  table
) {
  const source =
    await loadPdfJsDocument(
      templateBytes
    );

  const font =
    await pdf.embedFont(
      StandardFonts.Helvetica
    );

  const pages =
    pdf.getPages();

  /*
   * Cari halaman template yang mempunyai
   * header tabel.
   */

  for (
    let pageIndex = 0;
    pageIndex < source.numPages;
    pageIndex++
  ) {
    const sourcePage =
      await source.getPage(
        pageIndex + 1
      );

    const content =
      await sourcePage.getTextContent();

    const items =
      (content.items || [])
        .filter(
          item =>
            typeof item.str ===
              "string" &&
            item.str.trim()
        );

    const header =
      findTemplateTableHeader(
        items
      );

    if (!header) {
      continue;
    }

    const targetPage =
      pages[pageIndex];

    if (!targetPage) {
      continue;
    }

    /*
     * Tentukan area tabel
     * berdasarkan posisi header.
     */

    const startX =
      Math.min(
        ...header.map(
          x =>
            Number(
              x.transform?.[4] ||
              0
            )
        )
      );

    const headerY =
      Math.max(
        ...header.map(
          x =>
            Number(
              x.transform?.[5] ||
              0
            )
        )
      );

    /*
     * Lebar halaman.
     */

    const pageWidth =
      targetPage.getWidth();

    const pageHeight =
      targetPage.getHeight();

    const left =
      Math.max(
        25,
        startX - 5
      );

    const right =
      pageWidth - 25;

    const tableWidth =
      right - left;

    /*
     * Hapus area isi tabel lama,
     * tetapi tidak menghapus seluruh halaman.
     */

    const rowHeight = 18;

    const maxRows =
      Math.floor(
        (headerY - 40) /
        rowHeight
      );

    const rowsToDraw =
      table.rows.slice(
        0,
        Math.max(
          1,
          maxRows
        )
      );

    /*
     * Lebar kolom.
     *
     * Disesuaikan dengan tabel
     * PDF upload Guardian.
     */

    const ratios = [
      0.05,
      0.10,
      0.22,
      0.09,
      0.09,
      0.17,
      0.12,
      0.16
    ];

    const widths =
      ratios.map(
        ratio =>
          tableWidth *
          ratio
      );

    /*
     * Mulai di bawah header.
     */

    let y =
      headerY -
      28;

    /*
     * Tutup area data lama.
     */

    targetPage.drawRectangle({
      x:
        left - 2,

      y:
        Math.max(
          25,
          y -
            rowsToDraw.length *
              rowHeight -
            5
        ),

      width:
        tableWidth + 4,

      height:
        rowsToDraw.length *
          rowHeight +
        10,

      color:
        rgb(
          1,
          1,
          1
        )
    });

    /*
     * Gambar rows.
     */

    for (
      const row of rowsToDraw
    ) {
      let x =
        left;

      for (
        let col = 0;
        col < widths.length;
        col++
      ) {
        const width =
          widths[col];

        targetPage.drawRectangle({
          x,

          y:
            y -
            rowHeight,

          width,

          height:
            rowHeight,

          borderColor:
            rgb(
              0,
              0,
              0
            ),

          borderWidth:
            0.5
        });

        const value =
          String(
            row[col] || ""
          );

        if (value) {
          targetPage.drawText(
            fitText(
              value,
              font,
              7,
              width - 4
            ),
            {
              x:
                x + 2,

              y:
                y -
                12,

              size:
                7,

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

        x +=
          width;
      }

      y -=
        rowHeight;

      if (
        y < 30
      ) {
        break;
      }
    }

    break;
  }

  try {
    await source.destroy();
  } catch (_) {}
}


/* =========================================================
 * FIND TEMPLATE TABLE HEADER
 * ========================================================= */

function findTemplateTableHeader(
  items
) {
  const matches = [];

  for (
    const item of items
  ) {
    const text =
      String(
        item.str || ""
      ).trim();

    if (
      TABLE_HEADER_HINTS.some(
        hint =>
          text
            .toLowerCase()
            .includes(
              hint.toLowerCase()
            )
      )
    ) {
      matches.push(
        item
      );
    }
  }

  /*
   * Kita butuh minimal 2 header.
   */

  if (
    matches.length < 2
  ) {
    return null;
  }

  /*
   * Ambil yang berada pada
   * baris Y yang sama.
   */

  const firstY =
    Number(
      matches[0]
        .transform?.[5] ||
      0
    );

  const sameRow =
    matches.filter(
      item =>
        Math.abs(
          Number(
            item.transform?.[5] ||
            0
          ) -
          firstY
        ) <= 5
    );

  if (
    sameRow.length < 2
  ) {
    return null;
  }

  return sameRow
    .sort(
      (a, b) =>
        Number(
          a.transform?.[4] ||
          0
        ) -
        Number(
          b.transform?.[4] ||
          0
        )
    );
}


/* =========================================================
 * TTD + STEMPEL
 * ========================================================= */

async function placeSignatureAndStamp(
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

  let ttdImage =
    null;

  let stampImage =
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

  const source =
    await loadPdfJsDocument(
      templateBytes
    );

  const pages =
    pdf.getPages();

  for (
    let pageIndex = 0;
    pageIndex < source.numPages;
    pageIndex++
  ) {
    const sourcePage =
      await source.getPage(
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

    /*
     * =====================================================
     * TTD
     * =====================================================
     */

    if (ttdImage) {
      const item =
        items.find(
          x =>
            String(
              x.str || ""
            )
              .trim()
              .toLowerCase() ===
            "ttd"
        );

      if (item) {
        const x =
          Number(
            item.transform?.[4] ||
            0
          );

        const y =
          Number(
            item.transform?.[5] ||
            0
          );

        const width =
          Math.max(
            Number(
              item.width || 30
            ),
            30
          );

        targetPage.drawRectangle({
          x:
            x - 4,

          y:
            y - 15,

          width:
            width + 8,

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
         * Posisi TTD.
         *
         * Dipertahankan seperti
         * setting yang sebelumnya
         * sudah berhasil.
         */

        targetPage.drawImage(
          ttdImage,
          {
            x:
              x - 15,

            y:
              y + 3,

            width:
              105,

            height:
              55
          }
        );
      }
    }

    /*
     * =====================================================
     * STEMPEL
     * =====================================================
     */

    if (stampImage) {
      const item =
        items.find(
          x =>
            String(
              x.str || ""
            )
              .trim()
              .toLowerCase() ===
            "stempel"
        );

      if (item) {
        const x =
          Number(
            item.transform?.[4] ||
            0
          );

        const y =
          Number(
            item.transform?.[5] ||
            0
          );

        const width =
          Math.max(
            Number(
              item.width || 50
            ),
            50
          );

        targetPage.drawRectangle({
          x:
            x - 4,

          y:
            y - 15,

          width:
            width + 8,

          height:
            25,

          color:
            rgb(
              1,
              1,
              1
            )
        });

        targetPage.drawImage(
          stampImage,
          {
            x:
              x - 5,

            y:
              y - 48,

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
    await source.destroy();
  } catch (_) {}
}


/* =========================================================
 * SKU
 * ========================================================= */

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

  /*
   * Fallback angka.
   */

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
 * CSV
 * ========================================================= */

function parseCSV(
  text
) {
  const clean =
    String(
      text || ""
    ).replace(
      /^\uFEFF/,
      ""
    );

  const lines =
    clean
      .split(/\r?\n/)
      .filter(
        line =>
          line.trim()
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
        values[j] ??
        "";
    }

    rows.push(
      row
    );
  }

  return rows;
}


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
    ) ||
    null
  );
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
 * TEXT HELPERS
 * ========================================================= */

function wrapText(
  text,
  maxChars
) {
  const words =
    String(
      text
    ).split(/\s+/);

  const lines = [];

  let line =
    "";

  for (
    const word of words
  ) {
    const test =
      line
        ? `${line} ${word}`
        : word;

    if (
      test.length >
        maxChars &&
      line
    ) {
      lines.push(
        line
      );

      line =
        word;
    } else {
      line =
        test;
    }
  }

  if (
    line
  ) {
    lines.push(
      line
    );
  }

  return lines;
}


function fitText(
  text,
  font,
  size,
  maxWidth
) {
  let result =
    String(
      text || ""
    );

  if (
    font.widthOfTextAtSize(
      result,
      size
    ) <= maxWidth
  ) {
    return result;
  }

  while (
    result.length > 3 &&
    font.widthOfTextAtSize(
      result + "...",
      size
    ) > maxWidth
  ) {
    result =
      result.slice(
        0,
        -1
      );
  }

  return result + "...";
}


/* =========================================================
 * DOWNLOAD
 * ========================================================= */

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
 * BASE64
 * ========================================================= */

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
   * IMG HTML
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

  if (
    !value
  ) {
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
      binary.charCodeAt(
        i
      );
  }

  return bytes;
}


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
 * BYTES → BASE64
 * ========================================================= */

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
            i +
              chunkSize,
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
 * VALIDATE PDF
 * ========================================================= */

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
 * JPG
 * ========================================================= */

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
 * JSON
 * ========================================================= */

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
