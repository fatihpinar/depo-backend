// src/app.js
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const routes = require("./routers");

const app = express();

// Virgülle ayrılmış liste destekle:
// FRONTEND_ORIGIN= "http://localhost:5173, https://demo.wareflow.app"
const ORIGINS = (process.env.FRONTEND_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // curl/postman gibi Origin göndermeyenler
      if (!origin) return cb(null, true);

      if (ORIGINS.includes(origin)) return cb(null, true);

      return cb(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    credentials: true,
  })
);

app.use(express.json());
app.use("/api", routes);

module.exports = app;
