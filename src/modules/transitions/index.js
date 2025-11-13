// Tek noktadan dışa aktarım
const router = require("./transitions.router");
const service = require("./transitions.service");
const constants = require("./transitions.constants");

module.exports = {
  router,
  service,
  ...constants,
};
