export default {

  async fetch(request) {

    if (request.method === "POST") {

      const body = await request.json();

      return new Response(

        JSON.stringify({

          success: true,

          message: "Cloudflare Worker berhasil menerima POST.",

          received: body

        }),

        {

          status: 200,

          headers: {

            "Content-Type":
              "application/json"

          }

        }

      );

    }


    return new Response(

      JSON.stringify({

        success: false,

        message:
          "Gunakan POST."

      }),

      {

        status: 405,

        headers: {

          "Content-Type":
            "application/json"

        }

      }

    );

  }

};
