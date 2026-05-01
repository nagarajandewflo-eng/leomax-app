const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, authorizeRoles } = require("../middleware/auth");
const { camelToSnake } = require("../utils/caseConverter");
const cloudinary = require('cloudinary').v2;
const { randomUUID } = require('crypto');
require("dotenv").config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

/* -------------------------------------------------------
   SEARCH PRODUCTS
-------------------------------------------------------- */
router.get('/search', async (req, res) => {
  try {
    const { name, feature, fieldKey, fieldValue, categoryId } = req.query;
    let q = 'SELECT * FROM products WHERE 1=1';
    const values = [];
    let idx = 1;

    if (name) {
      q += ` AND LOWER(name) LIKE $${idx++}`;
      values.push(`%${name.toLowerCase()}%`);
    }

    if (feature && ['is_top_selling', 'is_featured', 'is_budget_friendly'].includes(feature)) {
      q += ` AND "${feature}" = true`;
    }

    if (categoryId) {
      q += ` AND category_id = $${idx++}`;
      values.push(categoryId);
    }

    if (fieldKey && fieldValue) {
      q += ` AND "custom_fields"::jsonb @> $${idx++}::jsonb`;
      values.push(JSON.stringify({ [fieldKey]: fieldValue }));
    }

    q += ' ORDER BY name ASC';
    const result = await db.query(q, values);

    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error searching products:", err);
    res.status(500).json({ error: 'Failed to search products' });
  }
});

/* -------------------------------------------------------
   GET MINIMAL PRODUCT LIST
   Returns: product_id, product_name, product_image, product_code, category_id
-------------------------------------------------------- */
router.get('/minimal', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const q = `
      SELECT 
        id AS product_id,
        name AS product_name,
        product_code,
        category_id,
        (
          SELECT images->>0
          FROM jsonb_array_elements(images) AS images
          LIMIT 1
        ) AS product_image
      FROM products
      ORDER BY name ASC
    `;

    const result = await db.query(q);
    res.json(result.rows);

  } catch (err) {
    console.error("❌ Error fetching minimal product list:", err);
    res.status(500).json({ error: "Failed to load minimal product list" });
  }
});

/* -------------------------------------------------------
   GET ALL PRODUCTS
-------------------------------------------------------- */
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM products ORDER BY name ASC');
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching products:", err);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

/* -------------------------------------------------------
   GET PRODUCT BY ID
-------------------------------------------------------- */
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM products WHERE id = $1',
      [req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("❌ Error fetching product:", err);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

/* -------------------------------------------------------
   CREATE PRODUCT (ONE CATEGORY)
-------------------------------------------------------- */
router.post('/', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const p = camelToSnake(req.body);
    const uuid = randomUUID();

    const category_id = p.category_id || null;

    const images = Array.isArray(p.images) ? p.images : JSON.parse(p.images || "[]");
    const customFields = Array.isArray(p.custom_fields)
      ? p.custom_fields
      : JSON.parse(p.custom_fields || "[]");


    const q = `
      INSERT INTO products
        (id, product_code, name, brand_name, buying_price, selling_price, vendor_price,
         quantity, date, images, is_top_selling, is_featured, is_budget_friendly,
         custom_fields, description, category_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING *
    `;

    const values = [
      uuid,
      p.product_code,
      p.name,
      p.brand_name,
      p.buying_price,
      p.selling_price,
      p.vendor_price,
      p.quantity,
      p.date,
      JSON.stringify(images),
      p.is_top_selling === "true" || p.is_top_selling === true,
      p.is_featured === "true" || p.is_featured === true,
      p.is_budget_friendly === "true" || p.is_budget_friendly === true,
      JSON.stringify(customFields),
      p.description || null,
      category_id
    ];

    const result = await db.query(q, values);
    res.status(201).json(result.rows[0]);

  } catch (err) {
    console.error("❌ Error creating product:", err);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

/* -------------------------------------------------------
   UPDATE PRODUCT (ONE CATEGORY)
-------------------------------------------------------- */
router.put('/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {

    const p = camelToSnake(req.body);
    const categoryId = p.category_id || null;

    let images = Array.isArray(p.images) ? p.images : JSON.parse(p.images || "[]");
    let customFields = p.custom_fields.length > 0 ? JSON.parse(p.custom_fields) : [];

    const q = `
      UPDATE products SET
        product_code=$1, name=$2, brand_name=$3, buying_price=$4, selling_price=$5, vendor_price=$6,
        quantity=$7, date=$8, images=$9, is_top_selling=$10, is_featured=$11,
        is_budget_friendly=$12, custom_fields=$13, description=$14, category_id=$15
      WHERE id=$16
      RETURNING *
    `;

    const values = [
      p.product_code,
      p.name,
      p.brand_name,
      p.buying_price,
      p.selling_price,
      p.vendor_price,
      p.quantity,
      p.date,
      JSON.stringify(images),
      p.is_top_selling === "true" || p.is_top_selling === true,
      p.is_featured === "true" || p.is_featured === true,
      p.is_budget_friendly === "true" || p.is_budget_friendly === true,
      JSON.stringify(customFields),
      p.description || null,
      categoryId,
      req.params.id
    ];

    const result = await db.query(q, values);
    res.json(result.rows[0]);

  } catch (err) {
    console.error("❌ Error updating product:", err);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

/* -------------------------------------------------------
   DELETE PRODUCT + CLOUDINARY IMAGES
-------------------------------------------------------- */
router.delete('/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const productRes = await db.query(
      `SELECT * FROM products WHERE id=$1`,
      [req.params.id]
    );

    if (!productRes.rows.length) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const product = productRes.rows[0];
    let images = Array.isArray(product.images) ? product.images : JSON.parse(product.images || "[]");

    const getPublicId = (url) => {
      const parts = url.split('/');
      const fileWithExt = parts.pop();
      return fileWithExt.substring(0, fileWithExt.lastIndexOf('.'));
    };

    const publicIds = images.map(getPublicId);
    if (publicIds.length > 0) {
      await cloudinary.api.delete_resources(publicIds);
    }

    const deleteRes = await db.query(
      `DELETE FROM products WHERE id=$1 RETURNING *`,
      [req.params.id]
    );

    res.json({ deleted: true, product: deleteRes.rows[0] });

  } catch (err) {
    console.error("❌ Error deleting product:", err);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// MOVE PRODUCT TO ANOTHER CATEGORY
router.put("/:id/move", authenticateToken, authorizeRoles("admin"), async (req, res) => {
  try {
    const newCategoryId = req.body.new_category_id;
    console.log("Moving product:", req.params.id, "to category:", newCategoryId);

    if (!newCategoryId)
      return res.status(400).json({ error: "newCategoryId is required" });

    const result = await db.query(
      `UPDATE products 
       SET category_id = $1
       WHERE id = $2
       RETURNING *`,
      [newCategoryId, req.params.id]
    );

    if (!result.rows.length)
      return res.status(404).json({ error: "Product not found" });

    res.json(result.rows[0]);
  } catch (err) {
    console.error("❌ Error moving product:", err);
    res.status(500).json({ error: "Failed to move product" });
  }
});

module.exports = router;
