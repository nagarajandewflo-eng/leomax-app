const express = require("express");
const router = express.Router();
const db = require("../db");
const { authenticateToken, authorizeRoles } = require("../middleware/auth");
const { randomUUID } = require("crypto");

/* ======================================================
   1. GET ALL CATEGORIES (flat list)
====================================================== */
router.get("/", async (req, res) => {
  try {
    const categories = await db.query(`
      SELECT 
        c.*,
        (
          SELECT COUNT(*) 
          FROM products p 
          WHERE p.category_id = c.id
        ) AS product_count
      FROM categories c
      ORDER BY c.name ASC
    `);

    res.json(categories.rows);
  } catch (err) {
    console.error("❌ Error fetching categories:", err);
    res.status(500).json({ error: "Failed to fetch categories" });
  }
});

/* ======================================================
   2. GET NESTED CATEGORY TREE + PRODUCT COUNT
====================================================== */
router.get("/nested", async (req, res) => {
  try {
    const catRes = await db.query(`SELECT * FROM categories ORDER BY name ASC`);

    const map = {};
    catRes.rows.forEach(c => {
      map[c.id] = { ...c, children: [], product_count: 0 };
    });

    const countRes = await db.query(`
      SELECT category_id AS id, COUNT(*) AS count
      FROM products
      WHERE category_id IS NOT NULL
      GROUP BY category_id
    `);

    countRes.rows.forEach(r => {
      if (map[r.id]) map[r.id].product_count = Number(r.count);
    });

    const root = [];
    Object.values(map).forEach(cat => {
      if (!cat.parent_id) root.push(cat);
      else if (map[cat.parent_id]) map[cat.parent_id].children.push(cat);
    });

    res.json(root);
  } catch (err) {
    console.error("❌ Error fetching nested categories:", err);
    res.status(500).json({ error: "Failed to fetch nested categories" });
  }
});

/* ======================================================
   3. GET ALL CATEGORIES WITH PRODUCTS (NESTED)
   --- MUST BE BEFORE /:id ROUTE
====================================================== */
router.get("/with-products", async (req, res) => {
  try {
    const catRes = await db.query(`SELECT * FROM categories ORDER BY name ASC`);
    const categories = catRes.rows;

    const prodRes = await db.query(`SELECT * FROM products ORDER BY name ASC`);
    const products = prodRes.rows;

    const map = {};
    categories.forEach((c) => {
      map[c.id] = { ...c, children: [] };
    });

    products.forEach((p) => {
      if (p.category_id && map[p.category_id]) {
        map[p.category_id].children.push({ ...p, type: "product" });
      }
    });

    const root = [];
    Object.values(map).forEach((cat) => {
      if (!cat.parent_id) root.push(cat);
      else if (map[cat.parent_id]) map[cat.parent_id].children.push(cat);
    });

    res.json(root);
  } catch (err) {
    console.error("❌ Error fetching categories with products:", err);
    res.status(500).json({ error: "Failed to fetch categories with products" });
  }
});

/* ======================================================
   4. GET SINGLE CATEGORY + PRODUCTS
====================================================== */
router.get("/:id", async (req, res) => {
  try {
    const catRes = await db.query(
      `SELECT * FROM categories WHERE id = $1`,
      [req.params.id]
    );

    if (!catRes.rows.length)
      return res.status(404).json({ error: "Category not found" });

    const productRes = await db.query(
      `SELECT * FROM products WHERE category_id = $1 ORDER BY name ASC`,
      [req.params.id]
    );

    res.json({
      category: catRes.rows[0],
      products: productRes.rows,
    });
  } catch (err) {
    console.error("❌ Error fetching category:", err);
    res.status(500).json({ error: "Failed to fetch category" });
  }
});

/* ======================================================
   5. CREATE CATEGORY
====================================================== */
router.post(
  "/",
  authenticateToken,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const { name, parentId, is_active, description } = req.body;

      if (!name)
        return res.status(400).json({ error: "Category name is required" });

      const result = await db.query(
        `INSERT INTO categories (id, name, parent_id, is_active, description)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [randomUUID(), name, parentId || null, is_active !== undefined ? is_active : false, description || null]
      );

      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("❌ Error creating category:", err);
      res.status(500).json({ error: "Failed to create category" });
    }
  }
);

/* ======================================================
   6. UPDATE CATEGORY
====================================================== */
router.put(
  "/:id",
  authenticateToken,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      const { name, parentId, is_active, description } = req.body;

      const result = await db.query(
        `UPDATE categories
         SET name = $1, parent_id = $2, is_active = $3, description = $4, updated_at = NOW()
         WHERE id = $5`,
        [name, parentId || null, is_active !== undefined ? is_active : false, description || null, req.params.id]
      );

      if (!result.rowCount)
        return res.status(404).json({ error: "Category not found" });
      res.json(result.rows[0]);
    } catch (err) {
      console.error("❌ Error updating category:", err);
      res.status(500).json({ error: "Failed to update category" });
    }
  }
);

/* ======================================================
   7. DELETE CATEGORY (move children → root)
====================================================== */
router.delete(
  "/:id",
  authenticateToken,
  authorizeRoles("admin"),
  async (req, res) => {
    try {
      // Make all child categories root
      await db.query(
        `UPDATE categories SET parent_id = NULL WHERE parent_id = $1`,
        [req.params.id]
      );

      // Delete category
      const result = await db.query(
        `DELETE FROM categories WHERE id = $1 RETURNING *`,
        [req.params.id]
      );

      if (!result.rows.length)
        return res.status(404).json({ error: "Category not found" });

      res.json({ deleted: true });
    } catch (err) {
      console.error("❌ Error deleting category:", err);
      res.status(500).json({ error: "Failed to delete category" });
    }
  }
);

module.exports = router;
