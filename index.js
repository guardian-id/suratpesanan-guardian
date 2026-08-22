import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
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

let pdfJsPromise = null;

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

      /*
       * =====================================================
       * 1. AMBIL TEMPLATE DARI GITHUB
       * =====================================================
       */

      const templateUrl =
        template === "prekursor"
          ? PREKURSOR_URL
          : REGULER_URL;

      const templateBytes =
        await downloadBytes(templateUrl);

      validatePdf(
        templateBytes,
        "Template PDF"
      );

      /*
       * =====================================================
       * 2. PDF UPLOAD
       *
       * PDF upload dipakai untuk:
       * - menentukan jumlah halaman
       * - Prekursor: membaca SKU
       * =====================================================
       */

      let uploadedBytes = null;
      let uploadedPageCount = 1;

      if (body.pdfBase64) {
        uploadedBytes =
          base64ToBytes(
            body.pdfBase64
          );

        validatePdf(
          uploadedBytes,
          "pdfBase64"
        );

        uploadedPageCount =
          await getPdfPageCount(
            uploadedBytes
          );
      }

      /*
       * =====================================================
       * 3. LOAD TEMPLATE
       * =====================================================
       */

      const sourceTemplate =
        await PDFDocument.load(
          templateBytes
        );

      const templatePageCount =
        sourceTemplate.getPageCount();

      /*
       * =====================================================
       * 4. BUAT PDF OUTPUT
       *
       * Jumlah halaman mengikuti PDF upload.
       * =====================================================
       */

      const outputPdf =
        await PDFDocument.create();

      if (
        uploadedPageCount <= 0
      ) {
        uploadedPageCount = 1;
      }

      for (
        let i = 0;
        i < uploadedPageCount;
        i++
      ) {
        /*
         * Kalau template punya halaman sebanyak
         * PDF upload, gunakan halaman yang sama.
         *
         * Kalau jumlah template lebih sedikit,
         * gunakan halaman terakhir sebagai fallback.
         */
        const sourceIndex =
          Math.min(
            i,
            templatePageCount - 1
          );

        const copiedPages =
          await outputPdf.copyPages(
            sourceTemplate,
            [sourceIndex]
          );

        outputPdf.addPage(
          copiedPages[0]
        );
      }

      /*
       * =====================================================
       * 5. DATA Satu - Duabelas
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
       * =====================================================
       * 6. PREKURSOR LOOKUP
       * =====================================================
       */

      let lookupInfo = null;

      if (
        template === "prekursor"
      ) {
        if (!uploadedBytes) {
          throw new Error(
            "pdfBase64 wajib dikirim untuk template Prekursor."
          );
        }

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
            `SKU tidak ditemukan di master_prekursor.csv. SKU yang terbaca: ${skuList.join(", ")}`
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
          productSKU: foundSKU,
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
       * 7. REPLACE Satu - Duabelas
       * =====================================================
       */

      await replaceAllPages(
        outputPdf,
        data
      );

      /*
       * =====================================================
       * 8. TTD + STEMPEL
       * =====================================================
       */

      await placeSignatureAndStamp(
        outputPdf,
        body.ttdBase64 || "",
        body.stempelBase64 || ""
      );

      /*
       * =====================================================
       * 9. SAVE
       * =====================================================
       */

      const outputBytes =
        await outputPdf.save();

      const outputBase64 =
        bytesToBase64(
          outputBytes
        );

      const result = {
        success: true,

        message:
          "PDF berhasil diproses.",

        template:
          template === "prekursor"
            ? "Prekursor"
            : "Reguler",

        pages:
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

      return json(result);

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


/*
 * ==========================================================
 * REPLACE SEMUA HALAMAN
 * ==========================================================
 *
 * Prinsip:
 *
 *     Satu ......................
 *     ↓
 *     Satu + seluruh teks
 *     setelahnya pada baris
 *     ↓
 *     HAPUS
 *     ↓
 *     NILAI JSON
 *
 * Prefix sebelum placeholder
 * tetap dipertahankan.
 *
 * Contoh:
 *
 * NO SIPA: Tujuh.................
 *
 * menjadi:
 *
 * NO SIPA: 123456789
 *
 * ==========================================================
 */

async function replaceAllPages(
  pdf,
  data
) {
  const pdfjs =
    await getPdfJs();

  const font =
    await pdf.embedFont(
      StandardFonts.Helvetica
    );

  const pages =
    pdf.getPages();

  /*
   * Kita baca PDF output yang sudah
   * berisi template.
   */
  const outputBytes =
    await pdf.save();

  const source =
    await pdfjs.getDocument({
      data:
        new Uint8Array(
          outputBytes
        ),
      useSystemFonts: true
    }).promise;

  for (
    let pageIndex = 0;
    pageIndex < pages.length;
    pageIndex++
  ) {
    const page =
      pages[pageIndex];

    const sourcePage =
      await source.getPage(
        pageIndex + 1
      );

    const textContent =
      await sourcePage.getTextContent();

    const items =
      textContent.items || [];

    /*
     * Cari setiap placeholder.
     */
    for (
      const key of PLACEHOLDERS
    ) {
      const value =
        String(
          data[key] ?? ""
        );

      const matches =
        findPlaceholderLines(
          items,
          key
        );

      for (
        const match of matches
      ) {
        drawReplacement(
          page,
          font,
          match,
          value
        );
      }
    }

    /*
     * Prekursor tambahan.
     */
    if (
      data.ZatAktif !== undefined
    ) {
      const matches =
        findPlaceholderLines(
          items,
          "ZatAktif"
        );

      for (
        const match of matches
      ) {
        drawReplacement(
          page,
          font,
          match,
          String(
            data.ZatAktif || ""
          )
        );
      }
    }

    if (
      data.Bentuk !== undefined
    ) {
      const matches =
        findPlaceholderLines(
          items,
          "Bentuk"
        );

      for (
        const match of matches
      ) {
        drawReplacement(
          page,
          font,
          match,
          String(
            data.Bentuk || ""
          )
        );
      }
    }
  }

  try {
    await source.destroy();
  } catch (_) {}
}


/*
 * ==========================================================
 * CARI PLACEHOLDER + SELURUH TEKS PADA BARIS
 * ==========================================================
 */

function findPlaceholderLines(
  items,
  target
) {
  const results = [];

  /*
   * Buat kelompok berdasarkan posisi Y.
   *
   * PDF text sering mempunyai beberapa
   * item untuk satu baris.
   */
  const lines =
    groupItemsIntoLines(
      items
    );

  for (
    const line of lines
  ) {
    const fullText =
      line
        .map(
          item =>
            typeof item.str === "string"
              ? item.str
              : ""
        )
        .join("");

    if (
      !fullText.includes(target)
    ) {
      continue;
    }

    /*
     * Cari item tempat placeholder berada.
     */
    let foundIndex = -1;

    for (
      let i = 0;
      i < line.length;
      i++
    ) {
      const text =
        String(
          line[i].str || ""
        );

      if (
        text.includes(target)
      ) {
        foundIndex = i;
        break;
      }
    }

    /*
     * Kalau placeholder terpecah,
     * cari kombinasi beberapa item.
     */
    if (
      foundIndex === -1
    ) {
      let combined = "";

      for (
        let i = 0;
        i < line.length;
        i++
      ) {
        combined +=
          String(
            line[i].str || ""
          );

        if (
          combined.includes(
            target
          )
        ) {
          foundIndex = i;
          break;
        }
      }
    }

    if (
      foundIndex === -1
    ) {
      continue;
    }

    const placeholderItem =
      findPlaceholderItem(
        line,
        target
      );

    if (
      !placeholderItem
    ) {
      continue;
    }

    /*
     * Posisi awal placeholder.
     */
    const x =
      placeholderItem.transform?.[4] || 0;

    const y =
      placeholderItem.transform?.[5] || 0;

    const fontSize =
      Math.max(
        6,
        Math.abs(
          placeholderItem.transform?.[3] || 10
        )
      );

    /*
     * Semua item setelah posisi
     * placeholder dianggap bagian
     * dari isi lama yang harus dihapus.
     *
     * Item sebelum placeholder
     * TIDAK dihapus.
     */
    const afterItems =
      getItemsFromPlaceholder(
        line,
        target
      );

    let right =
      x + 30;

    for (
      const item of afterItems
    ) {
      const itemX =
        item.transform?.[4] || 0;

      const itemWidth =
        item.width || 0;

      right =
        Math.max(
          right,
          itemX + itemWidth
        );
    }

    /*
     * Jangan terlalu sempit.
     */
    right =
      Math.max(
        right,
        x + target.length * fontSize * 0.6
      );

    results.push({
      x,
      y,
      fontSize,
      width:
        right - x,
      lineHeight:
        fontSize * 1.25
    });
  }

  return results;
}


/*
 * ==========================================================
 * GROUP TEXT ITEMS MENJADI BARIS
 * ==========================================================
 */

function groupItemsIntoLines(
  items
) {
  const valid =
    items
      .filter(
        item =>
          item &&
          typeof item.str === "string" &&
          item.str.trim() !== "" &&
          Array.isArray(item.transform)
      )
      .slice();

  /*
   * Urutkan:
   * atas → bawah
   * kiri → kanan
   */
  valid.sort(
    (a, b) => {
      const ay =
        a.transform?.[5] || 0;

      const by =
        b.transform?.[5] || 0;

      if (
        Math.abs(ay - by) > 3
      ) {
        return by - ay;
      }

      const ax =
        a.transform?.[4] || 0;

      const bx =
        b.transform?.[4] || 0;

      return ax - bx;
    }
  );

  const lines = [];

  for (
    const item of valid
  ) {
    const y =
      item.transform?.[5] || 0;

    let line = null;

    for (
      const existing of lines
    ) {
      if (
        Math.abs(
          existing.y - y
        ) <= 3
      ) {
        line = existing;
        break;
      }
    }

    if (!line) {
      line = {
        y,
        items: []
      };

      lines.push(line);
    }

    line.items.push(
      item
    );
  }

  for (
    const line of lines
  ) {
    line.items.sort(
      (a, b) => {
        const ax =
          a.transform?.[4] || 0;

        const bx =
          b.transform?.[4] || 0;

        return ax - bx;
      }
    );
  }

  return lines.map(
    line =>
      line.items
  );
}


/*
 * ==========================================================
 * CARI ITEM PLACEHOLDER
 * ==========================================================
 */

function findPlaceholderItem(
  line,
  target
) {
  /*
   * Normal.
   */
  for (
    const item of line
  ) {
    const text =
      String(
        item.str || ""
      );

    if (
      text.includes(target)
    ) {
      return item;
    }
  }

  /*
   * Terpecah:
   *
   * "Sa" + "tu"
   */
  for (
    let i = 0;
    i < line.length;
    i++
  ) {
    let combined = "";

    for (
      let j = i;
      j < Math.min(
        i + 8,
        line.length
      );
      j++
    ) {
      combined +=
        String(
          line[j].str || ""
        );

      if (
        combined.includes(
          target
        )
      ) {
        return line[i];
      }
    }
  }

  return null;
}


/*
 * ==========================================================
 * AMBIL ITEM DARI PLACEHOLDER SAMPAI AKHIR BARIS
 * ==========================================================
 */

function getItemsFromPlaceholder(
  line,
  target
) {
  const result = [];

  let started = false;
  let combined = "";

  for (
    const item of line
  ) {
    const text =
      String(
        item.str || ""
      );

    if (!started) {
      combined += text;

      if (
        text.includes(target)
      ) {
        started = true;
        result.push(item);
      }

      continue;
    }

    result.push(item);
  }

  /*
   * Placeholder terpecah.
   */
  if (
    !started
  ) {
    combined = "";

    for (
      const item of line
    ) {
      combined +=
        String(
          item.str || ""
        );

      result.push(item);

      if (
        combined.includes(
          target
        )
      ) {
        return result;
      }
    }

    return [];
  }

  return result;
}


/*
 * ==========================================================
 * GAMBAR ULANG VALUE
 * ==========================================================
 */

function drawReplacement(
  page,
  font,
  match,
  value
) {
  const x =
    match.x;

  const y =
    match.y;

  const fontSize =
    match.fontSize;

  /*
   * Area lama ditutup.
   *
   * Kita hapus dari posisi placeholder
   * sampai ujung teks pada baris tersebut.
   */
  page.drawRectangle({
    x:
      x - 2,

    y:
      y - fontSize - 3,

    width:
      Math.max(
        match.width + 8,
        50
      ),

    height:
      fontSize + 8,

    color:
      rgb(
        1,
        1,
        1
      ),

    opacity:
      1
  });

  /*
   * Kalau kosong, cukup hapus.
   */
  if (
    !value ||
    value.trim() === ""
  ) {
    return;
  }

  /*
   * Lebar area dibuat cukup besar.
   */
  const maxWidth =
    Math.max(
      match.width,
      100
    );

  /*
   * Untuk teks pendek:
   * satu baris.
   */
  if (
    value.length <= 55
  ) {
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
          ),

        maxWidth,

        lineHeight:
          match.lineHeight
      }
    );

    return;
  }

  /*
   * Untuk teks panjang:
   * wrap manual.
   */
  const words =
    value.split(/\s+/);

  const lines = [];
  let current = "";

  for (
    const word of words
  ) {
    const test =
      current
        ? `${current} ${word}`
        : word;

    const width =
      font.widthOfTextAtSize(
        test,
        fontSize
      );

    if (
      width <= maxWidth
    ) {
      current = test;
    } else {
      if (current) {
        lines.push(
          current
        );
      }

      current = word;
    }
  }

  if (current) {
    lines.push(
      current
    );
  }

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {
    page.drawText(
      lines[i],
      {
        x,

        y:
          y -
          fontSize -
          i *
            match.lineHeight,

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


/*
 * ==========================================================
 * TTD + STEMPEL
 * ==========================================================
 */

async function placeSignatureAndStamp(
  pdf,
  ttdInput,
  stampInput
) {
  if (
    !ttdInput &&
    !stampInput
  ) {
    return;
  }

  let ttdImage = null;
  let stampImage = null;

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

  const currentBytes =
    await pdf.save();

  const pdfjs =
    await getPdfJs();

  const source =
    await pdfjs.getDocument({
      data:
        new Uint8Array(
          currentBytes
        ),
      useSystemFonts: true
    }).promise;

  const pages =
    pdf.getPages();

  for (
    let pageIndex = 0;
    pageIndex < pages.length;
    pageIndex++
  ) {
    const page =
      pages[pageIndex];

    const sourcePage =
      await source.getPage(
        pageIndex + 1
      );

    const content =
      await sourcePage.getTextContent();

    const items =
      content.items || [];

    /*
     * TTD
     */
    if (ttdImage) {
      const matches =
        findKeyword(
          items,
          "TTD"
        );

      if (
        matches.length
      ) {
        const match =
          matches[0];

        const x =
          match.transform?.[4] || 0;

        const y =
          match.transform?.[5] || 0;

        page.drawRectangle({
          x:
            x - 4,

          y:
            y - 15,

          width:
            Math.max(
              match.width || 30,
              30
            ) + 8,

          height:
            24,

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

    /*
     * STEMPEL
     */
    if (stampImage) {
      const matches =
        findKeyword(
          items,
          "Stempel"
        );

      if (
        matches.length
      ) {
        const match =
          matches[0];

        const x =
          match.transform?.[4] || 0;

        const y =
          match.transform?.[5] || 0;

        page.drawRectangle({
          x:
            x - 4,

          y:
            y - 15,

          width:
            Math.max(
              match.width || 50,
              50
            ) + 8,

          height:
            24,

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
    await source.destroy();
  } catch (_) {}
}


/*
 * ==========================================================
 * FIND KEYWORD
 * ==========================================================
 */

function findKeyword(
  items,
  keyword
) {
  const result = [];

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
        keyword
      )
    ) {
      result.push(item);
    }
  }

  return result;
}


/*
 * ==========================================================
 * PDF PAGE COUNT
 * ==========================================================
 */

async function getPdfPageCount(
  bytes
) {
  const pdfjs =
    await getPdfJs();

  const document =
    await pdfjs.getDocument({
      data:
        new Uint8Array(
          bytes
        ),
      useSystemFonts: true
    }).promise;

  const count =
    document.numPages;

  try {
    await document.destroy();
  } catch (_) {}

  return count;
}


/*
 * ==========================================================
 * EXTRACT PDF TEXT
 * ==========================================================
 */

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
      useSystemFonts: true
    }).promise;

  const pages = [];

  for (
    let i = 1;
    i <= document.numPages;
    i++
  ) {
    const page =
      await document.getPage(i);

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

    pages.push(text);
  }

  try {
    await document.destroy();
  } catch (_) {}

  return pages.join("\n");
}


/*
 * ==========================================================
 * PDF.JS
 * ==========================================================
 */

async function getPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise =
      import(
        "pdfjs-serverless"
      );
  }

  return pdfJsPromise;
}


/*
 * ==========================================================
 * SKU
 * ==========================================================
 */

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


/*
 * ==========================================================
 * CSV
 * ==========================================================
 */

function parseCSV(
  text
) {
  const cleanText =
    String(
      text || ""
    ).replace(
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


/*
 * ==========================================================
 * DOWNLOAD
 * ==========================================================
 */

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


/*
 * ==========================================================
 * BASE64
 * ==========================================================
 */

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


/*
 * ==========================================================
 * BYTES → BASE64
 * ==========================================================
 */

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


/*
 * ==========================================================
 * VALIDATE PDF
 * ==========================================================
 */

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


/*
 * ==========================================================
 * JPG
 * ==========================================================
 */

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


/*
 * ==========================================================
 * JSON RESPONSE
 * ==========================================================
 */

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
