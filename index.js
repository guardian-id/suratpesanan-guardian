import { getDocument } from "pdfjs-serverless";

/*
==========================================================
GITHUB
==========================================================
*/

const GITHUB_BASE =
  "https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main";

const REGULER_HTML_URL =
  `${GITHUB_BASE}/Reguler.html`;

const PREKURSOR_HTML_URL =
  `${GITHUB_BASE}/Prekursor.html`;

const MASTER_URL =
  `${GITHUB_BASE}/master_prekursor.csv`;


/*
==========================================================
PLACEHOLDERS
==========================================================
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
==========================================================
MAIN WORKER
==========================================================
*/

export default {

  async fetch(request, env) {

    try {

      /*
      ------------------------------------------------------
      METHOD
      ------------------------------------------------------
      */

      if (request.method !== "POST") {

        return json(
          {
            success: false,
            message: "Method harus POST."
          },
          405
        );

      }


      /*
      ------------------------------------------------------
      JSON
      ------------------------------------------------------
      */

      const body =
        await request.json();


      /*
      ------------------------------------------------------
      TEMPLATE
      ------------------------------------------------------
      */

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


      /*
      ------------------------------------------------------
      PDF UPLOAD WAJIB
      ------------------------------------------------------
      */

      const pdfBase64 =
        String(
          body.pdfBase64 || ""
        ).trim();


      if (!pdfBase64) {

        throw new Error(
          "pdfBase64 wajib dikirim."
        );

      }


      /*
      ------------------------------------------------------
      BACA PDF UPLOAD
      ------------------------------------------------------
      */

      const uploadedPdf =
        base64ToBytes(
          pdfBase64
        );


      validatePdf(
        uploadedPdf,
        "pdfBase64"
      );


      /*
      ------------------------------------------------------
      EXTRACT DATA PDF
      ------------------------------------------------------
      */

      const pdfData =
        await extractPdfTableData(
          uploadedPdf
        );


      if (
        !pdfData.pages ||
        pdfData.pages.length === 0
      ) {

        throw new Error(
          "Tidak ada halaman pada PDF upload."
        );

      }


      /*
      ------------------------------------------------------
      MASTER PREKURSOR
      ------------------------------------------------------
      */

      let master = [];

      if (template === "prekursor") {

        const masterCsv =
          await downloadText(
            MASTER_URL
          );

        master =
          parseCSV(
            masterCsv
          );

      }


      /*
      ------------------------------------------------------
      TEMPLATE HTML
      ------------------------------------------------------
      */

      const templateUrl =
        template === "prekursor"
          ? PREKURSOR_HTML_URL
          : REGULER_HTML_URL;


      let templateHtml =
        await downloadText(
          templateUrl
        );


      if (!templateHtml) {

        throw new Error(
          "Template HTML kosong."
        );

      }


      /*
      ------------------------------------------------------
      DATA JSON
      ------------------------------------------------------
      */

      const data = {};

      for (const key of PLACEHOLDERS) {

        data[key] =
          body[key] === undefined ||
          body[key] === null
            ? ""
            : String(body[key]);

      }


      /*
      ------------------------------------------------------
      TTD + STEMPEL
      ------------------------------------------------------
      */

      const signatureHtml =
        createSignatureHtml(
          body.ttdBase64 || "",
          body.stempelBase64 || ""
        );


      /*
      ------------------------------------------------------
      BUAT HTML UNTUK SETIAP HALAMAN PDF UPLOAD
      ------------------------------------------------------

      Contoh:

      PDF upload 6 halaman
             ↓
      6 HTML page
             ↓
      Browser Run
             ↓
      PDF 6 halaman

      ------------------------------------------------------
      */

      const htmlPages = [];


      for (
        let pageIndex = 0;
        pageIndex < pdfData.pages.length;
        pageIndex++
      ) {

        const pageData =
          pdfData.pages[pageIndex];


        /*
        ----------------------------------------------------
        TABLE
        ----------------------------------------------------
        */

        const tableHtml =
          await createTableHtml(
            pageData.rows,
            template,
            master
          );


        /*
        ----------------------------------------------------
        COPY TEMPLATE
        ----------------------------------------------------
        */

        let html =
          templateHtml;


        /*
        ----------------------------------------------------
        REPLACE JSON
        ----------------------------------------------------
        */

        for (const key of PLACEHOLDERS) {

          html =
            replaceAll(
              html,
              `{{${key}}}`,
              escapeHtml(
                data[key]
              )
            );

        }


        /*
        ----------------------------------------------------
        TABLE
        ----------------------------------------------------
        */

        html =
          replaceAll(
            html,
            "{{TablePDF}}",
            tableHtml
          );


        /*
        ----------------------------------------------------
        TTD + STEMPEL
        ----------------------------------------------------
        */

        html =
          replaceAll(
            html,
            "{{TTD&Stemp}}",
            signatureHtml
          );


        /*
        ----------------------------------------------------
        PAGE CONTROL
        ----------------------------------------------------
        */

        html =
          prepareSingleA4Page(
            html,
            pageIndex + 1,
            pdfData.pages.length
          );


        htmlPages.push(
          html
        );

      }


      /*
      ======================================================
      GABUNGKAN SEMUA PAGE HTML
      ======================================================
      */

      const finalHtml =
        combinePages(
          htmlPages
        );


      /*
      ======================================================
      BATAS KEAMANAN
      ======================================================
      */

      if (
        finalHtml.length >
        45 * 1024 * 1024
      ) {

        throw new Error(
          "HTML hasil terlalu besar untuk Browser Run."
        );

      }


      /*
      ======================================================
      HTML → PDF
      ======================================================

      Cloudflare Browser Run
      ======================================================
      */

      const pdfResponse =
        await env.BROWSER.quickAction(
          "pdf",
          {
            html: finalHtml,

            gotoOptions: {
              waitUntil: "networkidle0",
              timeout: 45000
            },

            printBackground: true,

            preferCSSPageSize: true,

            margin: {
              top: "0mm",
              right: "0mm",
              bottom: "0mm",
              left: "0mm"
            }
          }
        );


      if (!pdfResponse.ok) {

        const errorText =
          await safeResponseText(
            pdfResponse
          );

        throw new Error(
          `Browser Run gagal: HTTP ${pdfResponse.status} ${errorText}`
        );

      }


      /*
      ======================================================
      PDF RESPONSE
      ======================================================
      */

      const outputBytes =
        new Uint8Array(
          await pdfResponse.arrayBuffer()
        );


      validatePdf(
        outputBytes,
        "PDF hasil Browser Run"
      );


      /*
      ======================================================
      PDF → BASE64
      ======================================================
      */

      const outputBase64 =
        bytesToBase64(
          outputBytes
        );


      /*
      ======================================================
      RESPONSE
      ======================================================
      */

      return json({

        success: true,

        message:
          "PDF berhasil dibuat dari template HTML.",

        template:
          template === "prekursor"
            ? "Prekursor"
            : "Reguler",

        pages:
          pdfData.pages.length,

        rows:
          pdfData.totalRows,

        spBase64:
          outputBase64

      });


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
==========================================================
EXTRACT PDF TABLE DATA
==========================================================
*/

async function extractPdfTableData(
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

  let totalRows = 0;


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
        );


    /*
    --------------------------------------------------------
    GROUP TEXT BERDASARKAN BARIS
    --------------------------------------------------------
    */

    const lines =
      groupTextLines(
        items
      );


    /*
    --------------------------------------------------------
    DETEKSI HEADER
    --------------------------------------------------------
    */

    const headerIndex =
      findTableHeaderIndex(
        lines
      );


    /*
    --------------------------------------------------------
    AMBIL BARIS SETELAH HEADER
    --------------------------------------------------------
    */

    const rows =
      parseTableRows(
        lines,
        headerIndex
      );


    totalRows +=
      rows.length;


    pages.push({

      pageNumber,

      rows,

      rawLines:
        lines.map(
          line =>
            line.text
        )

    });

  }


  try {

    await document.destroy();

  } catch (_) {}


  return {

    pages,

    totalRows

  };

}


/*
==========================================================
GROUP TEXT ITEMS INTO LINES
==========================================================
*/

function groupTextLines(
  items
) {

  const tolerance = 3;

  const groups = [];


  for (const item of items) {

    const x =
      Number(
        item.transform?.[4] || 0
      );

    const y =
      Number(
        item.transform?.[5] || 0
      );


    let group =
      groups.find(
        g =>
          Math.abs(
            g.y - y
          ) <= tolerance
      );


    if (!group) {

      group = {

        y,

        items: []

      };

      groups.push(
        group
      );

    }


    group.items.push({

      x,

      y,

      text:
        String(
          item.str || ""
        ).trim(),

      width:
        Number(
          item.width || 0
        )

    });

  }


  /*
  --------------------------------------------------------
  URUTKAN ATAS → BAWAH
  --------------------------------------------------------
  */

  groups.sort(
    (a, b) =>
      b.y - a.y
  );


  /*
  --------------------------------------------------------
  URUTKAN KIRI → KANAN
  --------------------------------------------------------
  */

  return groups.map(
    group => {

      group.items.sort(
        (a, b) =>
          a.x - b.x
      );


      return {

        y:
          group.y,

        items:
          group.items,

        text:
          group.items
            .map(
              item =>
                item.text
            )
            .join(" ")
            .replace(
              /\s+/g,
              " "
            )
            .trim()

      };

    }
  );

}


/*
==========================================================
FIND TABLE HEADER
==========================================================
*/

function findTableHeaderIndex(
  lines
) {

  const requiredWords = [
    "product",
    "sku"
  ];


  for (
    let i = 0;
    i < lines.length;
    i++
  ) {

    const text =
      normalizeText(
        lines[i].text
      );


    const hasProduct =
      text.includes(
        "product"
      );


    const hasSku =
      text.includes(
        "sku"
      );


    const hasDescription =
      text.includes(
        "description"
      );


    if (
      hasProduct &&
      hasSku
    ) {

      return i;

    }


    if (
      hasDescription &&
      (
        text.includes(
          "kemasan"
        ) ||
        text.includes(
          "qty"
        ) ||
        text.includes(
          "jumlah"
        )
      )
    ) {

      return i;

    }

  }


  return -1;

}


/*
==========================================================
PARSE TABLE ROWS
==========================================================
*/

function parseTableRows(
  lines,
  headerIndex
) {

  const rows = [];


  /*
  --------------------------------------------------------
  Kalau header tidak ditemukan,
  coba cari baris yang diawali angka.
  --------------------------------------------------------
  */

  const start =
    headerIndex >= 0
      ? headerIndex + 1
      : 0;


  let current = null;


  for (
    let i = start;
    i < lines.length;
    i++
  ) {

    const line =
      lines[i];


    const text =
      line.text.trim();


    if (!text) {
      continue;
    }


    /*
    ------------------------------------------------------
    DETEKSI NOMOR BARIS
    ------------------------------------------------------
    */

    const numberMatch =
      text.match(
        /^(\d{1,4})\b/
      );


    if (numberMatch) {

      /*
      ----------------------------------------------------
      SIMPAN BARIS SEBELUMNYA
      ----------------------------------------------------
      */

      if (current) {

        rows.push(
          finalizeRawRow(
            current
          )
        );

      }


      /*
      ----------------------------------------------------
      BARIS BARU
      ----------------------------------------------------
      */

      current = {

        no:
          numberMatch[1],

        text:
          text.substring(
            numberMatch[0].length
          ).trim(),

        items:
          line.items

      };

    } else if (current) {

      /*
      ----------------------------------------------------
      LANJUTAN BARIS
      ----------------------------------------------------
      */

      current.text +=
        " " +
        text;

      current.items.push(
        ...line.items
      );

    }

  }


  if (current) {

    rows.push(
      finalizeRawRow(
        current
      )
    );

  }


  /*
  --------------------------------------------------------
  FILTER BARIS YANG BUKAN DATA
  --------------------------------------------------------
  */

  return rows.filter(
    row =>
      row.no &&
      row.name
  );

}


/*
==========================================================
RAW ROW
==========================================================
*/

function finalizeRawRow(
  raw
) {

  const tokens =
    raw.items
      .map(
        item =>
          ({
            x:
              item.x,

            text:
              item.text
          })
      );


  /*
  --------------------------------------------------------
  HAPUS NOMOR DARI ITEM
  --------------------------------------------------------
  */

  const no =
    String(
      raw.no || ""
    ).trim();


  /*
  --------------------------------------------------------
  COBA DETEKSI KOLOM BERDASARKAN POSISI
  --------------------------------------------------------
  */

  const columns =
    detectColumns(
      tokens
    );


  /*
  --------------------------------------------------------
  FALLBACK TEXT
  --------------------------------------------------------
  */

  return {

    no,

    name:
      columns.name ||
      raw.text,

    sku:
      columns.sku || "",

    satuan:
      columns.satuan || "",

    jumlah:
      columns.jumlah || "",

    keterangan:
      columns.keterangan || "",

    rawText:
      raw.text

  };

}


/*
==========================================================
DETECT COLUMNS
==========================================================
*/

function detectColumns(
  items
) {

  if (!items.length) {

    return {};

  }


  const result = {

    sku: "",

    name: "",

    satuan: "",

    jumlah: "",

    keterangan: ""

  };


  /*
  --------------------------------------------------------
  BUAT TOKEN TEXT
  --------------------------------------------------------
  */

  const clean =
    items.map(
      item =>
        ({
          x:
            item.x,

          text:
            item.text.trim()
        })
    );


  /*
  --------------------------------------------------------
  SKU
  --------------------------------------------------------
  */

  const skuIndex =
    clean.findIndex(
      item =>
        /^\d{4,15}$/.test(
          item.text
        )
    );


  if (skuIndex >= 0) {

    result.sku =
      clean[skuIndex].text;

  }


  /*
  --------------------------------------------------------
  SATUAN
  --------------------------------------------------------
  */

  const satuanIndex =
    clean.findIndex(
      item =>
        isUnit(
          item.text
        )
    );


  if (satuanIndex >= 0) {

    result.satuan =
      clean[satuanIndex].text;

  }


  /*
  --------------------------------------------------------
  JUMLAH
  --------------------------------------------------------
  */

  const numericIndexes =
    [];


  for (
    let i = 0;
    i < clean.length;
    i++
  ) {

    if (
      /^\d+$/.test(
        clean[i].text
      )
    ) {

      numericIndexes.push(
        i
      );

    }

  }


  if (
    numericIndexes.length > 0
  ) {

    /*
    Ambil angka terakhir
    sebagai kandidat jumlah.
    */

    const last =
      numericIndexes[
        numericIndexes.length - 1
      ];


    result.jumlah =
      clean[last].text;

  }


  /*
  --------------------------------------------------------
  NAMA OBAT
  --------------------------------------------------------
  */

  const nameParts = [];


  for (
    let i = 0;
    i < clean.length;
    i++
  ) {

    const value =
      clean[i].text;


    if (!value) {
      continue;
    }


    if (
      i === skuIndex
    ) {

      continue;

    }


    if (
      i === satuanIndex
    ) {

      continue;

    }


    /*
    Jangan masukkan angka
    murni ke nama.
    */

    if (
      /^\d+$/.test(
        value
      )
    ) {

      continue;

    }


    nameParts.push(
      value
    );

  }


  result.name =
    nameParts.join(" ");


  /*
  --------------------------------------------------------
  KETERANGAN
  --------------------------------------------------------

  Biasanya nomor batch / invoice.
  Ambil kandidat angka panjang.
  --------------------------------------------------------
  */

  const longNumbers =
    clean
      .filter(
        item =>
          /^\d{6,20}$/.test(
            item.text
          )
      )
      .map(
        item =>
          item.text
      );


  if (
    longNumbers.length > 0
  ) {

    result.keterangan =
      longNumbers[
        longNumbers.length - 1
      ];

  }


  return result;

}


/*
==========================================================
UNIT
==========================================================
*/

function isUnit(
  value
) {

  const units = [

    "BOX",
    "BOTOL",
    "BOTTLE",
    "PCS",
    "Pcs",
    "PACK",
    "STRIP",
    "TUBE",
    "SACHET",
    "VIAL",
    "AMPUL",
    "AMP",
    "TABLET",
    "KAPLET",
    "BLISTER",
    "CAN",
    "ROLL",
    "SET"

  ];


  return units.includes(
    String(
      value || ""
    ).trim()
  );

}


/*
==========================================================
CREATE TABLE HTML
==========================================================
*/

async function createTableHtml(
  rows,
  template,
  master
) {

  if (
    !rows ||
    rows.length === 0
  ) {

    return `
      <table class="medicine-table">
        <thead>
          <tr>
            <th>No</th>
            <th>Nama Obat</th>
            <th>Satuan</th>
            <th>Zat Aktif</th>
            <th>Bentuk</th>
            <th>Jumlah</th>
            <th>Keterangan</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colspan="7">
              Tidak ada data obat pada halaman ini.
            </td>
          </tr>
        </tbody>
      </table>
    `;

  }


  const bodyRows = [];


  for (const row of rows) {

    let zatAktif = "";
    let bentuk = "";


    /*
    --------------------------------------------------------
    PREKURSOR
    --------------------------------------------------------
    */

    if (
      template === "prekursor"
    ) {

      const found =
        findSKU(
          master,
          row.sku
        );


      if (found) {

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

      }

    }


    bodyRows.push(`

      <tr>

        <td>
          ${escapeHtml(row.no)}
        </td>

        <td>
          ${escapeHtml(row.name)}
        </td>

        <td>
          ${escapeHtml(row.satuan)}
        </td>

        <td>
          ${escapeHtml(zatAktif)}
        </td>

        <td>
          ${escapeHtml(bentuk)}
        </td>

        <td>
          ${escapeHtml(row.jumlah)}
        </td>

        <td>
          ${escapeHtml(row.keterangan)}
        </td>

      </tr>

    `);

  }


  return `

    <table class="medicine-table">

      <thead>

        <tr>

          <th>No</th>

          <th>Nama Obat</th>

          <th>Satuan</th>

          <th>Zat Aktif</th>

          <th>Bentuk</th>

          <th>Jumlah</th>

          <th>Keterangan</th>

        </tr>

      </thead>

      <tbody>

        ${bodyRows.join("")}

      </tbody>

    </table>

  `;

}


/*
==========================================================
PREPARE SINGLE A4 PAGE
==========================================================
*/

function prepareSingleA4Page(
  html,
  pageNumber,
  totalPages
) {

  /*
  --------------------------------------------------------
  TAMBAHKAN CSS KHUSUS
  --------------------------------------------------------
  */

  const extraCss = `

    <style>

      @page {
        size: A4 portrait;
        margin: 0;
      }

      html,
      body {
        width: 210mm;
        min-width: 210mm;
        max-width: 210mm;
        margin: 0;
        padding: 0;
        background: white;
      }

      .a4-container {

        width: 210mm !important;

        height: 297mm !important;

        min-height: 297mm !important;

        max-height: 297mm !important;

        margin: 0 !important;

        page-break-after: always;

        break-after: page;

        overflow: hidden;

        position: relative;

      }

      .medicine-table {

        width: 100%;

        border-collapse: collapse;

        table-layout: fixed;

        font-family: Arial, sans-serif;

        font-size: 9px;

        margin-top: 5px;

        margin-bottom: 5px;

      }

      .medicine-table th,
      .medicine-table td {

        border: 1px solid #000;

        padding: 4px;

        vertical-align: top;

        word-wrap: break-word;

        overflow-wrap: anywhere;

      }

      .medicine-table th {

        font-weight: bold;

        text-align: center;

      }

      .medicine-table th:nth-child(1),
      .medicine-table td:nth-child(1) {

        width: 6%;

        text-align: center;

      }

      .medicine-table th:nth-child(2),
      .medicine-table td:nth-child(2) {

        width: 27%;

      }

      .medicine-table th:nth-child(3),
      .medicine-table td:nth-child(3) {

        width: 10%;

        text-align: center;

      }

      .medicine-table th:nth-child(4),
      .medicine-table td:nth-child(4) {

        width: 18%;

      }

      .medicine-table th:nth-child(5),
      .medicine-table td:nth-child(5) {

        width: 12%;

      }

      .medicine-table th:nth-child(6),
      .medicine-table td:nth-child(6) {

        width: 8%;

        text-align: center;

      }

      .medicine-table th:nth-child(7),
      .medicine-table td:nth-child(7) {

        width: 19%;

      }

      .medicine-table tr {

        page-break-inside: avoid;

        break-inside: avoid;

      }

      .medicine-table thead {

        display: table-header-group;

      }

      .medicine-table tbody {

        display: table-row-group;

      }

      img {

        max-width: 100%;

      }

    </style>

  `;


  /*
  --------------------------------------------------------
  PAGE NUMBER
  --------------------------------------------------------
  */

  const pageInfo = `

    <div
      style="
        position:absolute;
        right:10mm;
        bottom:4mm;
        font-family:Arial,sans-serif;
        font-size:8px;
      "
    >
      ${pageNumber} / ${totalPages}
    </div>

  `;


  /*
  --------------------------------------------------------
  INSERT CSS
  --------------------------------------------------------
  */

  html =
    html.replace(
      "</head>",
      `${extraCss}</head>`
    );


  /*
  --------------------------------------------------------
  INSERT PAGE NUMBER
  --------------------------------------------------------
  */

  html =
    html.replace(
      "</body>",
      `${pageInfo}</body>`
    );


  return html;

}


/*
==========================================================
COMBINE HTML PAGES
==========================================================
*/

function combinePages(
  pages
) {

  return `

<!DOCTYPE html>

<html>

<head>

<meta charset="UTF-8">

<style>

@page {

  size: A4 portrait;

  margin: 0;

}

html,
body {

  margin: 0;

  padding: 0;

  width: 210mm;

  background: white;

}

.page-wrapper {

  width: 210mm;

  height: 297mm;

  min-height: 297mm;

  max-height: 297mm;

  page-break-after: always;

  break-after: page;

  overflow: hidden;

}

.page-wrapper:last-child {

  page-break-after: auto;

  break-after: auto;

}

</style>

</head>

<body>

${pages
  .map(
    page =>
      `<div class="page-wrapper">${extractBody(page)}</div>`
  )
  .join("\n")}

</body>

</html>

  `;

}


/*
==========================================================
EXTRACT BODY
==========================================================
*/

function extractBody(
  html
) {

  const match =
    html.match(
      /<body[^>]*>([\s\S]*?)<\/body>/i
    );


  if (match) {

    return match[1];

  }


  return html;

}


/*
==========================================================
SIGNATURE + STAMP
==========================================================
*/

function createSignatureHtml(
  ttdInput,
  stampInput
) {

  const ttd =
    normalizeImageInput(
      ttdInput
    );


  const stamp =
    normalizeImageInput(
      stampInput
    );


  if (
    !ttd &&
    !stamp
  ) {

    return "";

  }


  /*
  --------------------------------------------------------
  TTD + STEMPEL SATU BLOK
  --------------------------------------------------------
  */

  return `

    <div
      style="
        position:relative;
        width:150px;
        height:105px;
        margin-top:4px;
      "
    >

      ${
        stamp
          ? `
            <img
              src="${stamp}"
              style="
                position:absolute;
                left:0;
                top:8px;
                width:85px;
                height:85px;
                object-fit:contain;
                opacity:0.85;
                z-index:1;
              "
            >
          `
          : ""
      }

      ${
        ttd
          ? `
            <img
              src="${ttd}"
              style="
                position:absolute;
                left:30px;
                top:0;
                width:105px;
                height:55px;
                object-fit:contain;
                z-index:2;
              "
            >
          `
          : ""
      }

    </div>

  `;

}


/*
==========================================================
NORMALIZE IMAGE
==========================================================
*/

function normalizeImageInput(
  input
) {

  let value =
    String(
      input || ""
    ).trim();


  if (!value) {

    return "";

  }


  /*
  --------------------------------------------------------
  HTML IMG
  --------------------------------------------------------
  */

  const imgMatch =
    value.match(
      /<img[^>]+src=["'](data:image\/[^"']+)["']/i
    );


  if (
    imgMatch &&
    imgMatch[1]
  ) {

    return imgMatch[1];

  }


  /*
  --------------------------------------------------------
  DATA URI
  --------------------------------------------------------
  */

  if (
    value.startsWith(
      "data:image/"
    )
  ) {

    return value;

  }


  /*
  --------------------------------------------------------
  RAW BASE64
  --------------------------------------------------------
  */

  const clean =
    value.replace(
      /\s/g,
      ""
    );


  /*
  --------------------------------------------------------
  DETEKSI PNG
  --------------------------------------------------------
  */

  try {

    const bytes =
      base64ToBytes(
        clean
      );


    if (
      isPng(bytes)
    ) {

      return `
        data:image/png;base64,${clean}
      `;

    }


    if (
      isJpg(bytes)
    ) {

      return `
        data:image/jpeg;base64,${clean}
      `;

    }

  } catch (_) {}


  return "";

}


/*
==========================================================
CSV
==========================================================
*/

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


/*
==========================================================
FIND SKU
==========================================================
*/

function findSKU(
  rows,
  sku
) {

  const target =
    normalizeSKU(
      sku
    );


  if (!target) {

    return null;

  }


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


/*
==========================================================
NORMALIZE SKU
==========================================================
*/

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


/*
==========================================================
FIRST VALUE
==========================================================
*/

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
==========================================================
PDF.JS
==========================================================
*/

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


/*
==========================================================
DOWNLOAD TEXT
==========================================================
*/

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


  if (!response.ok) {

    throw new Error(
      `Gagal mengambil file GitHub: HTTP ${response.status}`
    );

  }


  return response.text();

}


/*
==========================================================
BASE64 → BYTES
==========================================================
*/

function base64ToBytes(
  input
) {

  let value =
    String(
      input || ""
    ).trim();


  /*
  --------------------------------------------------------
  DATA URI
  --------------------------------------------------------
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
  --------------------------------------------------------
  HTML IMG
  --------------------------------------------------------
  */

  const imgMatch =
    value.match(
      /<img[^>]+src=["']data:[^;]+;base64,([^"']+)["']/i
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


/*
==========================================================
BYTES → BASE64
==========================================================
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
==========================================================
PDF VALIDATION
==========================================================
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
==========================================================
PNG
==========================================================
*/

function isPng(
  bytes
) {

  return (

    bytes.length >= 8 &&

    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a

  );

}


/*
==========================================================
JPG
==========================================================
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
==========================================================
NORMALIZE TEXT
==========================================================
*/

function normalizeText(
  value
) {

  return String(
    value || ""
  )
    .toLowerCase()
    .replace(
      /\s+/g,
      " "
    )
    .trim();

}


/*
==========================================================
REPLACE ALL
==========================================================
*/

function replaceAll(
  text,
  search,
  replacement
) {

  return text.split(
    search
  ).join(
    replacement
  );

}


/*
==========================================================
ESCAPE HTML
==========================================================
*/

function escapeHtml(
  value
) {

  return String(
    value ?? ""
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );

}


/*
==========================================================
SAFE RESPONSE TEXT
==========================================================
*/

async function safeResponseText(
  response
) {

  try {

    return await response.text();

  } catch (_) {

    return "";

  }

}


/*
==========================================================
JSON RESPONSE
==========================================================
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
