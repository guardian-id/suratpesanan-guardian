import puppeteer from "@cloudflare/puppeteer";
import { PDFDocument } from "pdf-lib";

const GITHUB_RAW_BASE =
"https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main";

const REGULER_HTML_URL =
GITHUB_RAW_BASE + "/Reguler.html";

const PREKURSOR_HTML_URL =
GITHUB_RAW_BASE + "/Prekursor.html";

const MASTER_PREKURSOR_URL =
GITHUB_RAW_BASE + "/master_prekursor.csv";

export default {
async fetch(request, env) {

```
// ==========================================================
// GET HEALTH CHECK
// ==========================================================

if (request.method === "GET") {

  return jsonResponse({
    success: true,
    message: "SP GUARDIAN WORKER OK",
    version: "HTML-PDF-FINAL-2"
  });
}


// ==========================================================
// ONLY POST
// ==========================================================

if (request.method !== "POST") {

  return jsonResponse(
    {
      success: false,
      error: "Method not allowed"
    },
    405
  );
}


try {

  // ========================================================
  // READ JSON
  // ========================================================

  const body = await request.json();

  if (!body || typeof body !== "object") {

    return jsonResponse(
      {
        success: false,
        error: "Invalid JSON body"
      },
      400
    );
  }


  // ========================================================
  // INPUT
  // ========================================================

  const pdfBase64 =
    body.pdfBase64 || "";

  const ttdBase64 =
    body.ttdBase64 || "";

  const stempelBase64 =
    body.stempelBase64 || "";

  const template =
    String(body.template || "Reguler")
      .trim()
      .toLowerCase();


  const values = {

    Satu: body.Satu ?? "",
    Dua: body.Dua ?? "",
    Tiga: body.Tiga ?? "",
    Empat: body.Empat ?? "",
    Lima: body.Lima ?? "",
    Enam: body.Enam ?? "",
    Tujuh: body.Tujuh ?? "",
    Delapan: body.Delapan ?? "",
    Sembilan: body.Sembilan ?? "",
    Sepuluh: body.Sepuluh ?? "",
    Sebelas: body.Sebelas ?? "",
    Duabelas: body.Duabelas ?? ""
  };


  // ========================================================
  // TEMPLATE SELECTION
  // ========================================================

  let templateUrl =
    REGULER_HTML_URL;

  let templateName =
    "Reguler";


  if (template === "prekursor") {

    templateUrl =
      PREKURSOR_HTML_URL;

    templateName =
      "Prekursor";
  }


  // ========================================================
  // LOAD HTML FROM GITHUB
  // ========================================================

  const templateResponse =
    await fetch(templateUrl);


  if (!templateResponse.ok) {

    throw new Error(
      "Failed to load " +
      templateName +
      ".html. HTTP " +
      templateResponse.status
    );
  }


  let html =
    await templateResponse.text();


  // ========================================================
  // PREKURSOR MASTER LOOKUP
  // ========================================================

  let prekursorLookup = [];

  if (templateName === "Prekursor") {

    prekursorLookup =
      await loadPrekursorMaster();
  }


  // ========================================================
  // REPLACE PLACEHOLDERS
  // ========================================================

  html =
    replaceTemplateValues(
      html,
      values
    );


  // ========================================================
  // INSERT TTD + STEMPEL
  // ========================================================

  html =
    insertSignatureAndStamp(
      html,
      ttdBase64,
      stempelBase64
    );


  // ========================================================
  // CHECK BROWSER
  // ========================================================

  if (!env.BROWSER) {

    throw new Error(
      "BROWSER binding tidak ditemukan. Periksa wrangler.json."
    );
  }


  // ========================================================
  // LAUNCH BROWSER
  // ========================================================

  const browser =
    await puppeteer.launch(
      env.BROWSER
    );


  try {

    const page =
      await browser.newPage();


    // ======================================================
    // VIEWPORT
    // ======================================================

    await page.setViewport({
      width: 794,
      height: 1123,
      deviceScaleFactor: 1
    });


    // ======================================================
    // LOAD HTML
    // ======================================================

    await page.setContent(
      html,
      {
        waitUntil: "networkidle0"
      }
    );


    // ======================================================
    // GENERATE A4 PDF
    // ======================================================

    const generatedPdf =
      await page.pdf({
        format: "A4",

        printBackground: true,

        margin: {
          top: "0mm",
          right: "0mm",
          bottom: "0mm",
          left: "0mm"
        },

        preferCSSPageSize: true
      });


    // ======================================================
    // PDF-LIB
    // ======================================================

    const pdfDoc =
      await PDFDocument.load(
        generatedPdf
      );


    const finalPdf =
      await pdfDoc.save();


    // ======================================================
    // CLOSE BROWSER
    // ======================================================

    await browser.close();


    // ======================================================
    // RESPONSE
    // ======================================================

    return jsonResponse({

      success: true,

      template:
        templateName,

      pageCount:
        pdfDoc.getPageCount(),

      prekursorLookup:
        prekursorLookup.length,

      pdfBase64:
        uint8ArrayToBase64(
          finalPdf
        )
    });

  } catch (browserError) {

    try {
      await browser.close();
    } catch (_) {}

    throw browserError;
  }


} catch (error) {

  return jsonResponse(
    {
      success: false,

      error:
        error?.message ||
        String(error),

      stack:
        error?.stack ||
        null
    },
    500
  );
}
```

}
};

// ============================================================
// REPLACE TEMPLATE VALUES
// ============================================================

function replaceTemplateValues(
html,
values
) {

let result =
String(html);

for (
const [key, value]
of Object.entries(values)
) {

```
const safeValue =
  escapeHtml(
    String(value ?? "")
  );


// {{Satu}}

result =
  result.replace(
    new RegExp(
      "\\{\\{" +
      escapeRegExp(key) +
      "\\}\\}",
      "gi"
    ),
    safeValue
  );


// [[Satu]]

result =
  result.replace(
    new RegExp(
      "\\[\\[" +
      escapeRegExp(key) +
      "\\]\\]",
      "gi"
    ),
    safeValue
  );


// ${Satu}

result =
  result.replace(
    new RegExp(
      "\\$\\{" +
      escapeRegExp(key) +
      "\\}",
      "gi"
    ),
    safeValue
  );
```

}

return result;
}

// ============================================================
// INSERT TTD + STEMPEL
// ============================================================

function insertSignatureAndStamp(
html,
ttdBase64,
stempelBase64
) {

const ttd =
normalizeImageBase64(
ttdBase64
);

const stempel =
normalizeImageBase64(
stempelBase64
);

if (!ttd && !stempel) {

```
return html;
```

}

const signatureBlock = `

<style>

.sp-signature-block {

  position: absolute;

  right: 25mm;

  bottom: 22mm;

  width: 55mm;

  height: 35mm;

  z-index: 9999;

  pointer-events: none;

}

.sp-stempel {

  position: absolute;

  left: 0;

  bottom: 0;

  width: 25mm;

  height: 25mm;

  object-fit: contain;

}

.sp-ttd {

  position: absolute;

  left: 12mm;

  bottom: 8mm;

  width: 40mm;

  height: 22mm;

  object-fit: contain;

}

</style>

<div class="sp-signature-block">

${
stempel
? '<img class="sp-stempel" src="' +
   stempel +
   '">'
: ''
}

${
ttd
? '<img class="sp-ttd" src="' +
   ttd +
   '">'
: ''
}

</div>

`;

if (
html.includes("</body>")
) {

```
return html.replace(
  "</body>",
  signatureBlock +
  "</body>"
);
```

}

return html +
signatureBlock;
}

// ============================================================
// PREKURSOR MASTER
// ============================================================

async function loadPrekursorMaster() {

const response =
await fetch(
MASTER_PREKURSOR_URL
);

if (!response.ok) {

```
throw new Error(
  "Failed to load master_prekursor.csv. HTTP " +
  response.status
);
```

}

const csv =
await response.text();

return parseCsv(csv);
}

// ============================================================
// CSV PARSER
// ============================================================

function parseCsv(csv) {

const lines =
String(csv)
.split(/\r?\n/)
.filter(
line =>
line.trim() !== ""
);

if (lines.length < 2) {

```
return [];
```

}

const headers =
parseCsvLine(
lines[0]
);

const result = [];

for (
let i = 1;
i < lines.length;
i++
) {

```
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
    columns[j] ?? "";
}


result.push(row);
```

}

return result;
}

// ============================================================
// CSV LINE
// ============================================================

function parseCsvLine(line) {

const result = [];

let current = "";

let quoted = false;

for (
let i = 0;
i < line.length;
i++
) {

```
const char =
  line[i];


if (char === '"') {

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
```

}

result.push(
current.trim()
);

return result;
}

// ============================================================
// IMAGE BASE64 NORMALIZER
// ============================================================

function normalizeImageBase64(
value
) {

if (!value) {

```
return "";
```

}

const text =
String(value).trim();

if (
text.startsWith("data:image/")
) {

```
return text;
```

}

return (
"data:image/png;base64," +
text
);
}

// ============================================================
// HTML ESCAPE
// ============================================================

function escapeHtml(value) {

return String(value)

```
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
```

}

// ============================================================
// REGEX ESCAPE
// ============================================================

function escapeRegExp(value) {

return String(value)
.replace(
/[.*+?^${}()|[]\]/g,
"\$&"
);
}

// ============================================================
// UINT8 ARRAY → BASE64
// ============================================================

function uint8ArrayToBase64(bytes) {

let binary = "";

const chunkSize =
0x8000;

for (
let i = 0;
i < bytes.length;
i += chunkSize
) {

```
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
```

}

return btoa(binary);
}

// ============================================================
// JSON RESPONSE
// ============================================================

function jsonResponse(
data,
status = 200
) {

return new Response(
JSON.stringify(data),
{
status,

```
  headers: {
    "content-type":
      "application/json; charset=UTF-8"
  }
}
```

);
}
