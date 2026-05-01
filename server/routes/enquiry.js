const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// --- Create new enquiry ---
router.post('/', async (req, res) => {
  try {
    const { product_id, name, email, phone, message } = req.body;

    if (!product_id || !name || !email || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if product exists
    const productCheck = await db.query('SELECT id FROM products WHERE id = $1', [product_id]);
    if (!productCheck.rows.length) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const id = uuidv4();
    const q = `
      INSERT INTO enquiries (id, product_id, name, email, phone, message)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const values = [id, product_id, name, email, phone || null, message];

    const result = await db.query(q, values);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("❌ Error creating enquiry:", err);
    res.status(500).json({ error: 'Failed to create enquiry' });
  }
});

// --- Get all enquiries (admin only) ---
router.get('/', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const result = await db.query(`
      SELECT e.*, p.name AS product_name
      FROM enquiries e
      LEFT JOIN products p ON e.product_id = p.id
      ORDER BY e.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Error fetching enquiries:", err);
    res.status(500).json({ error: 'Failed to fetch enquiries' });
  }
});

// --- Get single enquiry by ID ---
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT e.*, p.name AS product_name
      FROM enquiries e
      LEFT JOIN products p ON e.product_id = p.id
      WHERE e.id = $1
    `, [req.params.id]);

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Enquiry not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("❌ Error fetching enquiry:", err);
    res.status(500).json({ error: 'Failed to fetch enquiry' });
  }
});

// --- Update enquiry status ---
router.put('/:id/status', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { status } = req.body;

    if (!['open', 'closed', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const result = await db.query(`
      UPDATE enquiries SET status = $1 WHERE id = $2 RETURNING *
    `, [status, req.params.id]);

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Enquiry not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("❌ Error updating enquiry status:", err);
    res.status(500).json({ error: 'Failed to update enquiry' });
  }
});

// --- Delete enquiry (admin only) ---
router.delete('/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const result = await db.query('DELETE FROM enquiries WHERE id = $1 RETURNING *', [req.params.id]);

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Enquiry not found' });
    }

    res.json({ deleted: true, enquiry: result.rows[0] });
  } catch (err) {
    console.error("❌ Error deleting enquiry:", err);
    res.status(500).json({ error: 'Failed to delete enquiry' });
  }
});

module.exports = router;
