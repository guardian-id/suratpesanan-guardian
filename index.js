import { getDocument } from "pdfjs-serverless";

const GITHUB_BASE =
  "https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main";

const TEMPLATE = {
  reguler:
    GITHUB_BASE + "/Reguler.html",

  prekursor:
    GITHUB_BASE + "/Prekursor.html"
};

const MASTER_PREKURSOR_URL =
  GITHUB_BASE + "/master_prekursor.csv";


export default {

  async fetch(request, env) {

    try {

      // =====================================================
      // METHOD
      // =====================================================

      if (request.method !== "POST") {

        return response({
          success: false,
          message: "Gunakan method POST."
        }, 405);
      }


      // =====================================================
      // JSON
      // =====================================================

      const body =
        await request.json();


      // =====================================================
      // TEMPLATE
      // =====================================================

      const templateName =
        detectTemplate(
          body.template
        );


      // =====================================================
      // PDF SOURCE
      // =====================================================

      const pdfBase64 =
        String(
          body.pdfBase64 || ""
        ).trim();


      if (!pdfBase64) {

        throw new Error(
          "pdfBase64 tidak ditemukan."
        );
      }


      // =====================================================
      // AMBIL TEMPLATE HTML
      // =====================================================

      const templateResponse =
        await fetch(
          TEMPLATE[templateName]
        );


      if (!templateResponse.ok) {

        throw new Error(
          "Template GitHub gagal diambil. HTTP " +
          templateResponse.status
        );
      }


      const templateHtml =
        await templateResponse.text();


      // =====================================================
      // REPLACE SATU - DUABELAS
      // =====================================================

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


      let baseHtml =
        templateHtml;


      for (
        const field of fields
      ) {

        const value =
          body[field] ?? "";


        baseHtml =
          baseHtml
            .split(
              `{{${field}}}`
            )
            .join(
              escapeHtml(
                String(value)
              )
            );
      }


      // =====================================================
      // TTD + STEMPEL
      // =====================================================

      const ttd =
        normalizeImage(
          body.ttdBase64
        );


      const stamp =
        normalizeImage(
          body.stempelBase64
        );


      let signatureHtml =
        "";


      if (
        ttd ||
        stamp
      ) {

        signatureHtml = `

          <div class="signature-container">

            ${
              stamp
                ? `
                  <img
                    src="${stamp}"
                    class="stamp"
                  >
                `
                : ""
            }

            ${
              ttd
                ? `
                  <img
                    src="${ttd}"
                    class="signature"
                  >
                `
                : ""
            }

          </div>

        `;
      }


      baseHtml =
        baseHtml
          .split(
            "{{TTD&Stemp}}"
          )
          .join(
            signatureHtml
          );


      // =====================================================
      // PDF SOURCE → TEXT
      // =====================================================

      const pdfBytes =
        base64ToUint8Array(
          pdfBase64
        );


      const pdfData =
        await extractPdfText(
          pdfBytes
        );


      // =====================================================
      // MASTER PREKURSOR
      //
      // HANYA LOAD JIKA PREKURSOR
      // =====================================================

      let masterPrekursor =
        [];


      if (
        templateName ===
        "prekursor"
      ) {

        masterPrekursor =
          await loadPrekursorMaster();
      }


      // =====================================================
      // PARSE PRODUCT PER HALAMAN
      // =====================================================

      const pageProducts =
        parseProductsByPage(
          pdfData
        );


      if (
        !pageProducts.length
      ) {

        throw new Error(
          "Tidak ditemukan data produk pada PDF sumber."
        );
      }


      // =====================================================
      // BUAT HTML UNTUK SETIAP HALAMAN
      //
      // PDF sumber 6 halaman
      // → template 6 halaman
      // =====================================================

      const pageHtml = [];


      for (
        let pageIndex = 0;
        pageIndex < pageProducts.length;
        pageIndex++
      ) {

        const products =
          pageProducts[
            pageIndex
          ];


        const tableHtml =
          buildMedicineTable(
            products,
            templateName,
            masterPrekursor
          );


        let page =
          baseHtml
            .split(
              "{{TablePDF}}"
            )
            .join(
              tableHtml
            );


        // ===================================================
        // ORDER DATE PER HALAMAN
        //
        // {{Tigabelas}} mengambil Order Date
        // dari halaman PDF sumber yang bersangkutan.
        //
        // Contoh:
        // Order Date : 2026-08-25
        //
        // menjadi:
        // 25-08-2026
        // ===================================================

        page =
          page
            .split(
              "{{Tigabelas}}"
            )
            .join(
              escapeHtml(
                products.orderDate || ""
              )
            );


        // ===================================================
        // {{Empatbelas}} DAN {{Limabelas}}
        //
        // Mengambil dari Order Date halaman PDF sumber
        //
        // Contoh:
        // Order Date : 2026-08-25
        //
        // {{Empatbelas}} = VIII
        // {{Limabelas}} = 2026
        // ===================================================

        const orderDateParts =
          getOrderDateParts(
            products.orderDate
          );


        page =
          page
            .split(
              "{{Empatbelas}}"
            )
            .join(
              escapeHtml(
                orderDateParts.monthRoman
              )
            );


        page =
          page
            .split(
              "{{Limabelas}}"
            )
            .join(
              escapeHtml(
                orderDateParts.year
              )
            );


        // ===================================================
        // HILANGKAN PLACEHOLDER YANG MASIH TERSISA
        // ===================================================

        page =
          page.replace(
            /\{\{[^{}]+\}\}/g,
            ""
          );


        // ===================================================
        // SETIAP PAGE = 1 A4
        // ===================================================

        page =
          wrapPage(
            page
          );


        pageHtml.push(
          page
        );
      }


      // =====================================================
      // GABUNG SEMUA HALAMAN
      // =====================================================

      let html =
        pageHtml.join("\n");


      // =====================================================
      // CSS PDF
      // =====================================================

      html =
        addPdfCss(
          html
        );


      // =====================================================
      // BROWSER
      // =====================================================

      if (!env.BROWSER) {

        throw new Error(
          "Binding BROWSER belum tersedia di Cloudflare Worker."
        );
      }


      // =====================================================
      // HTML → PDF
      // =====================================================

      const pdf =
        await env.BROWSER.quickAction(
          "pdf",
          {

            html: html,

            pdfOptions: {

              format: "a4",

              printBackground: true,

              preferCSSPageSize: true,

              margin: {

                top: "0",
                right: "0",
                bottom: "0",
                left: "0"

              }

            }

          }
        );


      if (!pdf.ok) {

        const error =
          await pdf.text();


        throw new Error(
          "HTML → PDF gagal: " +
          error
        );
      }


      // =====================================================
      // PDF → BASE64
      // =====================================================

      const finalPdfBytes =
        new Uint8Array(
          await pdf.arrayBuffer()
        );


      const spBase64 =
        bytesToBase64(
          finalPdfBytes
        );


      // =====================================================
      // RESPONSE
      // =====================================================

      return response({

        success: true,

        message:
          "PDF berhasil dibuat.",

        template:
          templateName ===
          "prekursor"
            ? "Prekursor"
            : "Reguler",

        sourcePageCount:
          pageProducts.length,

        productCount:
          pageProducts.reduce(
            (
              total,
              page
            ) =>
              total +
              page.length,
            0
          ),

        spBase64:
          spBase64

      });


    } catch (error) {

      return response({

        success: false,

        message:
          error?.message ||
          "Terjadi error."

      }, 500);
    }
  }
};


// =========================================================
// DETECT TEMPLATE
// =========================================================

function detectTemplate(
  value
) {

  const name =
    String(
      value || "Reguler"
    )
      .trim()
      .toLowerCase();


  // =====================================================
  // HANYA YANG MENGANDUNG "PREKURSOR"
  // → PREKURSOR
  //
  // SEMUA SELAIN ITU
  // → REGULER
  // =====================================================

  if (
    name.includes(
      "prekursor"
    )
  ) {

    return "prekursor";
  }


  return "reguler";
}


// =========================================================
// WRAP PAGE
// =========================================================

function wrapPage(
  html
) {

  return `

    <div class="pdf-page">

      ${html}

    </div>

  `;
}


// =========================================================
// PDF TEXT EXTRACTION
// =========================================================

async function extractPdfText(
  pdfBytes
) {

  const loadingTask =
    getDocument({

      data: pdfBytes,

      useSystemFonts: true

    });


  const document =
    await loadingTask.promise;


  const pages = [];


  for (
    let pageNumber = 1;
    pageNumber <=
    document.numPages;
    pageNumber++
  ) {

    const page =
      await document.getPage(
        pageNumber
      );


    const textContent =
      await page.getTextContent();


    const items =
      textContent.items
        .filter(
          item =>
            typeof item.str ===
              "string" &&
            item.str.trim() !== ""
        )
        .map(
          item => ({

            text:
              item.str.trim(),

            x:
              item.transform
                ? item.transform[4]
                : 0,

            y:
              item.transform
                ? item.transform[5]
                : 0

          })
        );


    const lines =
      groupTextItemsIntoLines(
        items
      );


    // ===================================================
    // ORDER DATE HALAMAN INI
    // ===================================================

    const orderDate =
      extractOrderDate(
        lines
      );


    pages.push({

      pageNumber,

      lines,

      orderDate

    });
  }


  return {

    pageCount:
      document.numPages,

    pages

  };
}


// =========================================================
// EXTRACT ORDER DATE
// =========================================================
//
// Format PDF:
// Order Date : 2026-08-25
//
// Hasil:
// 25-08-2026
//
// Dibuat cukup fleksibel apabila PDF.js
// memisahkan teks menjadi beberapa bagian.
// =========================================================

function extractOrderDate(
  lines
) {

  for (
    let i = 0;
    i < lines.length;
    i++
  ) {

    const text =
      String(
        lines[i] || ""
      )
        .replace(
          /\s+/g,
          " "
        )
        .trim();


    // ===================================================
    // FORMAT NORMAL
    //
    // Order Date : 2026-08-25
    // Order Date: 2026-08-25
    // ===================================================

    let match =
      text.match(
        /Order\s*Date\s*:?\s*(\d{4})-(\d{2})-(\d{2})/i
      );


    if (match) {

      const year =
        match[1];

      const month =
        match[2];

      const day =
        match[3];


      return `${day}-${month}-${year}`;
    }


    // ===================================================
    // JIKA PDF.js MEMISAHKAN:
    //
    // Order Date :
    // 2026-08-25
    // ===================================================

    if (
      /Order\s*Date/i.test(
        text
      )
    ) {

      for (
        let j = i + 1;
        j < Math.min(
          i + 3,
          lines.length
        );
        j++
      ) {

        const nextText =
          String(
            lines[j] || ""
          )
            .replace(
              /\s+/g,
              " "
            )
            .trim();


        const nextMatch =
          nextText.match(
            /(\d{4})-(\d{2})-(\d{2})/
          );


        if (nextMatch) {

          const year =
            nextMatch[1];

          const month =
            nextMatch[2];

          const day =
            nextMatch[3];


          return `${day}-${month}-${year}`;
        }
      }
    }
  }


  return "";
}


// =========================================================
// ORDER DATE → BULAN ROMAWI + TAHUN
// =========================================================
//
// Contoh:
// 25-08-2026
//
// monthRoman = VIII
// year       = 2026
// =========================================================

function getOrderDateParts(
  orderDate
) {

  const value =
    String(
      orderDate || ""
    ).trim();


  const match =
    value.match(
      /^(\d{2})-(\d{2})-(\d{4})$/
    );


  if (!match) {

    return {

      monthRoman:
        "",

      year:
        ""

    };
  }


  const month =
    match[2];

  const year =
    match[3];


  const monthRomanMap = {

    "01": "I",
    "02": "II",
    "03": "III",
    "04": "IV",
    "05": "V",
    "06": "VI",
    "07": "VII",
    "08": "VIII",
    "09": "IX",
    "10": "X",
    "11": "XI",
    "12": "XII"

  };


  return {

    monthRoman:
      monthRomanMap[month] || "",

    year:
      year

  };
}


// =========================================================
// GROUP TEXT INTO LINES
// =========================================================

function groupTextItemsIntoLines(
  items
) {

  const groups = [];

  const tolerance = 3;


  for (
    const item of items
  ) {

    let group =
      groups.find(
        g =>
          Math.abs(
            g.y -
            item.y
          ) <= tolerance
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


  groups.sort(
    (a, b) =>
      b.y - a.y
  );


  return groups.map(
    group => {

      group.items.sort(
        (a, b) =>
          a.x - b.x
      );


      return group.items
        .map(
          item =>
            item.text
        )
        .join(" ")
        .replace(
          /\s+/g,
          " "
        )
        .trim();

    }
  );
}


// =========================================================
// PARSE PRODUCTS PER PAGE
// =========================================================

function parseProductsByPage(
  pdfData
) {

  const result = [];


  for (
    const page of pdfData.pages
  ) {

    const products = [];


    for (
      const line of page.lines
    ) {

      const product =
        parseProductLine(
          line
        );


      if (product) {

        products.push(
          product
        );
      }
    }


    if (
      products.length > 0
    ) {

      // =================================================
      // SIMPAN ORDER DATE DARI HALAMAN INI
      // =================================================

      products.orderDate =
        page.orderDate || "";


      result.push(
        products
      );
    }
  }


  return result;
}


// =========================================================
// PARSE PRODUCT LINE
// =========================================================

function parseProductLine(
  line
) {

  const text =
    String(line)
      .replace(
        /\s+/g,
        " "
      )
      .trim();


  const startMatch =
    text.match(
      /^(\d+)\s+(\d{5,})\s+(.+)$/
    );


  if (!startMatch) {

    return null;
  }


  const no =
    startMatch[1];

  const sku =
    startMatch[2];

  const rest =
    startMatch[3].trim();


  const endMatch =
    rest.match(
      /^(.+?)\s+(\S+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\d{4}-\d{2}-\d{2})\s+(\d+)$/
    );


  if (!endMatch) {

    return null;
  }


  return {

    no:
      no,

    sku:
      sku,

    description:
      endMatch[1].trim(),

    kemasan:
      endMatch[2].trim(),

    casePack:
      endMatch[3].trim(),

    qty:
      endMatch[4].trim(),

    batch:
      endMatch[5].trim(),

    expiredDate:
      endMatch[6].trim(),

    invoice:
      endMatch[7].trim()

  };
}


// =========================================================
// BUILD MEDICINE TABLE
// =========================================================

function buildMedicineTable(
  products,
  templateName,
  masterPrekursor
) {

  let rows = "";


  for (
    const product of products
  ) {

    let zatAktif = "";

    let bentuk = "";


    // ===================================================
    // LOOKUP HANYA UNTUK PREKURSOR
    // ===================================================

    if (
      templateName ===
      "prekursor"
    ) {

      const master =
        masterPrekursor.find(
          row => {

            const masterSku =
              getMasterValue(
                row,
                [
                  "Produck SKU",
                  "Product SKU",
                  "ProductSKU",
                  "SKU",
                  "Sku",
                  "sku"
                ]
              );


            return (
              normalizeSku(
                masterSku
              ) ===
              normalizeSku(
                product.sku
              )
            );
          }
        );


      if (master) {

        zatAktif =
          String(
            master["Zat Aktif"] ??
            ""
          ).trim();


        bentuk =
          String(
            master["Bentuk"] ??
            ""
          ).trim();
      }
    }


    // ===================================================
    // KETERANGAN = INVOICE NO
    // ===================================================

    const keterangan =
      escapeHtml(
        product.invoice
      );


    // ===================================================
    // JUMLAH = CASE PACK + BILANGAN
    // ===================================================

    const jumlah =
      formatJumlah(
        product.casePack
      );


    // ===================================================
    // REGULER
    // ===================================================

    if (
      templateName ===
      "reguler"
    ) {

      rows += `

        <tr>

          <td>
            ${escapeHtml(
              product.no
            )}
          </td>

          <td>
            ${escapeHtml(
              product.description
            )}
          </td>

          <td>
            ${escapeHtml(
              product.kemasan
            )}
          </td>

          <td>
            ${escapeHtml(
              jumlah
            )}
          </td>

          <td>
            ${keterangan}
          </td>

        </tr>

      `;

    }


    // ===================================================
    // PREKURSOR
    // ===================================================

    else {

      rows += `

        <tr>

          <td>
            ${escapeHtml(
              product.no
            )}
          </td>

          <td>
            ${escapeHtml(
              product.description
            )}
          </td>

          <td>
            ${escapeHtml(
              product.kemasan
            )}
          </td>

          <td>
            ${escapeHtml(
              zatAktif
            )}
          </td>

          <td>
            ${escapeHtml(
              bentuk
            )}
          </td>

          <td>
            ${escapeHtml(
              jumlah
            )}
          </td>

          <td>
            ${keterangan}
          </td>

        </tr>

      `;
    }

  }


  // =====================================================
  // RETURN REGULER TABLE
  // =====================================================

  if (
    templateName ===
    "reguler"
  ) {

    return `

      <table class="medicine-table">

        <thead>

          <tr>

            <th>No</th>

            <th>Nama Obat</th>

            <th>Satuan</th>

            <th>Jumlah</th>

            <th>Keterangan</th>

          </tr>

        </thead>

        <tbody>

          ${rows}

        </tbody>

      </table>

    `;
  }


  // =====================================================
  // RETURN PREKURSOR TABLE
  // =====================================================

  return `

    <table class="medicine-table">

      <thead>

        <tr>

          <th>No</th>

          <th>Nama Obat</th>

          <th>Satuan</th>

          <th>Zat Aktif Prekursor</th>

          <th>Bentuk dan Kekuatan Sediaan</th>

          <th>Jumlah</th>

          <th>Keterangan</th>

        </tr>

      </thead>

      <tbody>

        ${rows}

      </tbody>

    </table>

  `;
}


// =========================================================
// ANGKA → BILANGAN INDONESIA
// =========================================================

function numberToIndonesianWords(
  value
) {

  const number =
    Number(
      String(value ?? "")
        .replace(/[^\d-]/g, "")
    );


  if (
    !Number.isFinite(number)
  ) {

    return String(
      value ?? ""
    );
  }


  if (
    number === 0
  ) {

    return "Nol";
  }


  const words = [

    "",

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

    "Sebelas"

  ];


  function convert(n) {

    if (
      n < 12
    ) {

      return words[n];
    }


    if (
      n < 20
    ) {

      return (
        words[n - 10] +
        " Belas"
      );
    }


    if (
      n < 100
    ) {

      return (
        words[
          Math.floor(
            n / 10
          )
        ] +
        " Puluh " +
        convert(
          n % 10
        )
      ).trim();
    }


    if (
      n < 200
    ) {

      return (
        "Seratus " +
        convert(
          n - 100
        )
      ).trim();
    }


    if (
      n < 1000
    ) {

      return (
        words[
          Math.floor(
            n / 100
          )
        ] +
        " Ratus " +
        convert(
          n % 100
        )
      ).trim();
    }


    if (
      n < 2000
    ) {

      return (
        "Seribu " +
        convert(
          n - 1000
        )
      ).trim();
    }


    if (
      n < 1000000
    ) {

      return (
        convert(
          Math.floor(
            n / 1000
          )
        ) +
        " Ribu " +
        convert(
          n % 1000
        )
      ).trim();
    }


    if (
      n < 1000000000
    ) {

      return (
        convert(
          Math.floor(
            n / 1000000
          )
        ) +
        " Juta " +
        convert(
          n % 1000000
        )
      ).trim();
    }


    if (
      n < 1000000000000
    ) {

      return (
        convert(
          Math.floor(
            n / 1000000000
          )
        ) +
        " Miliar " +
        convert(
          n % 1000000000
        )
      ).trim();
    }


    return String(n);
  }


  return convert(
    number
  )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


// =========================================================
// JUMLAH DENGAN BILANGAN
// =========================================================

function formatJumlah(
  value
) {

  const angka =
    String(
      value ?? ""
    ).trim();


  if (!angka) {

    return "";
  }


  const bilangan =
    numberToIndonesianWords(
      angka
    );


  return `${angka} (${bilangan})`;
}


// =========================================================
// MASTER PREKURSOR
// =========================================================

async function loadPrekursorMaster() {

  const response =
    await fetch(
      MASTER_PREKURSOR_URL
    );


  if (!response.ok) {

    throw new Error(
      "master_prekursor.csv gagal diambil. HTTP " +
      response.status
    );
  }


  const csv =
    await response.text();


  return parseCsv(
    csv
  );
}


// =========================================================
// CSV PARSER
// =========================================================

function parseCsv(
  csv
) {

  const lines =
    String(csv)
      .split(
        /\r?\n/
      )
      .filter(
        line =>
          line.trim() !== ""
      );


  if (
    lines.length < 2
  ) {

    return [];
  }


  const headers =
    parseCsvLine(
      lines[0]
    ).map(
      header =>
        header.trim()
    );


  const result = [];


  for (
    let i = 1;
    i < lines.length;
    i++
  ) {

    const columns =
      parseCsvLine(
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
        columns[j] ??
        "";
    }


    result.push(
      row
    );
  }


  return result;
}


// =========================================================
// CSV LINE
// =========================================================

function parseCsvLine(
  line
) {

  const result = [];

  let current = "";

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


// =========================================================
// SKU NORMALIZER
// =========================================================

function normalizeSku(
  value
) {

  return String(
    value ?? ""
  )
    .trim()
    .replace(
      /\.0$/,
      ""
    );
}


// =========================================================
// MASTER VALUE
// =========================================================

function getMasterValue(
  row,
  possibleNames
) {

  for (
    const name of
    possibleNames
  ) {

    if (
      row[name] !==
      undefined
    ) {

      return String(
        row[name] ??
        ""
      ).trim();
    }
  }


  return "";
}


// =========================================================
// IMAGE NORMALIZER
// =========================================================

function normalizeImage(
  value
) {

  if (!value) {

    return "";
  }


  let image =
    String(value).trim();


  if (
    image.startsWith(
      "data:image/"
    )
  ) {

    return image;
  }


  const match =
    image.match(
      /<img[^>]+src=["']([^"']+)["']/i
    );


  if (match) {

    return match[1];
  }


  image =
    image.replace(
      /\s/g,
      ""
    );


  return (
    "data:image/png;base64," +
    image
  );
}


// =========================================================
// BASE64 → UINT8 ARRAY
// =========================================================

function base64ToUint8Array(
  value
) {

  let base64 =
    String(value)
      .trim();


  if (
    base64.startsWith(
      "data:"
    )
  ) {

    const comma =
      base64.indexOf(",");


    if (
      comma !== -1
    ) {

      base64 =
        base64.slice(
          comma + 1
        );
    }
  }


  base64 =
    base64.replace(
      /\s/g,
      ""
    );


  const binary =
    atob(
      base64
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


// =========================================================
// HTML ESCAPE
// =========================================================

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


// =========================================================
// PDF CSS
// =========================================================

function addPdfCss(
  html
) {

  const css = `

    <style>

      @page {

        size: A4 portrait;

        margin: 0;

      }


      html,
      body {

        margin: 0;

        padding: 0;

      }


      .pdf-page {

        position: relative;

        width: 210mm;

        height: 297mm;

        box-sizing: border-box;

        page-break-after: always;

        overflow: hidden;

      }


      .pdf-page:last-child {

        page-break-after: auto;

      }


      table {

        width: 100%;

        border-collapse: collapse;

      }


      table th,
      table td {

        border: 1px solid #000;

        padding: 4px;

        vertical-align: top;

      }


      .medicine-table {

        width: 100%;

        table-layout: fixed;

        font-size: 9px;

      }


      .medicine-table th:nth-child(1) {

        width: 6%;

      }


      .medicine-table th:nth-child(2) {

        width: 25%;

      }


      .medicine-table th:nth-child(3) {

        width: 10%;

      }


      .medicine-table th:nth-child(4) {

        width: 19%;

      }


      .medicine-table th:nth-child(5) {

        width: 12%;

      }


      .medicine-table th:nth-child(6) {

        width: 8%;

      }


      .medicine-table th:nth-child(7) {

        width: 20%;

      }


      .signature-container {

        position: relative;

        width: 150px;

        height: 100px;

      }


      .signature-container .stamp {

        position: absolute;

        left: 40px;

        top: -5px;

        width: 85px;

        height: 85px;

        object-fit: contain;

        z-index: 1;

      }


      .signature-container .signature {

        position: absolute;

        left: 0;

        top: 0;

        width: 105px;

        height: 60px;

        object-fit: contain;

        z-index: 2;

      }

    </style>

  `;


  return html.replace(
    "</head>",
    css +
    "</head>"
  );
}


// =========================================================
// BYTES → BASE64
// =========================================================

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


  return btoa(
    binary
  );
}


// =========================================================
// JSON RESPONSE
// =========================================================

function response(
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
