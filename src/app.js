// src/app.js
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const routes = require('./routers');

const app = express();

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

app.use(
  cors({
    origin: FRONTEND_ORIGIN,
    credentials: true,
  })
);

app.use(express.json());
app.use('/api', routes);

module.exports = app;
