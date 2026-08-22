export default {
  fetch(request, env, ctx) {
    return new Response("SP GUARDIAN WORKER OK", {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=UTF-8"
      }
    });
  }
};
