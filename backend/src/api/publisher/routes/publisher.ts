export default {
  routes: [
    {
      method: "GET",
      path: "/publisher/site",
      handler: "publisher.site",
      config: { auth: false, policies: [], middlewares: [] },
    },
  ],
};
