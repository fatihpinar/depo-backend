// src/app.js
const express = require('express');
const cors = require('cors');

const routes = require('./routers');

const app = express();

// Middleware
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

// Tüm API rotaları
app.use('/api', routes);

module.exports = app;