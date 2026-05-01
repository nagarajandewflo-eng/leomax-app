require('dotenv').config();

const express = require('express');
const cors = require('cors');

// ROUTES (INSIDE SERVER FOLDER)
const productsRouter = require('./routes/products');
const authRouter = require('./routes/auth');
const enquiryRoutes = require('./routes/enquiry');
const categoryRoutes = require('./routes/category');

// UTILS
const { camelToSnake } = require('./utils/caseConverter');

const app = express();

/* -------------------- MIDDLEWARES -------------------- */

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Convert camelCase → snake_case
app.use((req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    req.body = camelToSnake(req.body);
  }
  next();
});

/* -------------------- API ROUTES -------------------- */

app.use('/api/products', productsRouter);
app.use('/api/auth', authRouter);
app.use('/api/enquiries', enquiryRoutes);
app.use('/api/categories', categoryRoutes);

/* -------------------- HEALTH CHECK -------------------- */

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'API running' });
});

/* -------------------- EXPORT ONLY -------------------- */
// ❌ DO NOT use app.listen()
// ✅ Required for Vercel

module.exports = app;
