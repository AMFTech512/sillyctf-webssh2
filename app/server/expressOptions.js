module.exports = {
  dotfiles: "ignore",
  etag: false,
  extensions: ["htm", "html"],
  index: false,
  maxAge: "1s",
  redirect: false,
  setHeaders: function (res, path, stat) {
    res.set("x-timestamp", Date.now());
    res.set({
      "Strict-Transport-Security": "max-age=31536000",
    });
  },
};
