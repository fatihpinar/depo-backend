// src/utils/fail.js
module.exports = function fail(code, status = 400, details = null, message) {
  const err = new Error(message || code);
  err.code = code;
  err.status = status;
  if (details) err.details = details;
  return err;
};
