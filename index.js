```javascript
const GITHUB_RAW_BASE =
  "https://raw.githubusercontent.com/guardian-id/suratpesanan-guardian/main";

const REGULER_HTML_URL =
  GITHUB_RAW_BASE + "/Reguler.html";

const PREKURSOR_HTML_URL =
  GITHUB_RAW_BASE + "/Prekursor.html";

const MASTER_PREKURSOR_URL =
  GITHUB_RAW_BASE + "/master_prekursor.csv";

export default {
  async fetch(request) {

    if (request.method === "GET") {

      return new Response(
        JSON.stringify({
          success: true,
          message: "SP GUARDIAN WORKER OK",
          regulerTemplate: REGULER_HTML_URL,
          prekursorTemplate: PREKURSOR_HTML_URL,
          masterPrekursor: MASTER_PREKURSOR_URL
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "POST received"
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      }
    );
  }
};
```
