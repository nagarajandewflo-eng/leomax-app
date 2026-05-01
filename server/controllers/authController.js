const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

// ==========================================================
// EMAIL SETUP
// ==========================================================
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SMTP_EMAIL,
    pass: process.env.SMTP_PASS,
  },
});

// ==========================================================
// TOKEN GENERATORS
// ==========================================================
const generateAccessToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      session_token: user.session_token, // IMPORTANT FOR SESSION MGMT
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" } // ⏳ Access Token: 1 hour
  );
};

const generateRefreshToken = (user) => {
  return jwt.sign(
    { id: user.id },
    process.env.REFRESH_SECRET,
    { expiresIn: "1d" } // ⏳ Refresh Token: 1 day
  );
};

// ==========================================================
// REGISTER
// ==========================================================
const register = async (req, res) => {
  try {
    let { email, password, role } = req.body;

    role = role?.toLowerCase();
    const userRole =
      role && ["vendor", "admin"].includes(role) ? role : "vendor";

    const exists = await pool.query(`SELECT id FROM users WHERE email=$1`, [email]);

    if (exists.rows.length > 0)
      return res.status(400).json({ error: "Email already exists" });

    const hashed = await bcrypt.hash(password, 10);

    const insertQ = `
      INSERT INTO users (email, password, role, must_change_password)
      VALUES ($1, $2, $3, TRUE)
      RETURNING id, email, role, must_change_password
    `;

    const { rows } = await pool.query(insertQ, [email, hashed, userRole]);

    return res.status(201).json({
      message: "User registered. Must change password on first login.",
      user: rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

// ==========================================================
// LOGIN WITH SESSION MANAGEMENT
// ==========================================================
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const { rows } = await pool.query(`SELECT * FROM users WHERE email=$1`, [email]);

    if (rows.length === 0)
      return res.status(400).json({ message: "Invalid credentials" });

    const user = rows[0];

    const validPw = await bcrypt.compare(password, user.password);
    if (!validPw)
      return res.status(400).json({ message: "Invalid credentials" });

    // Force password change on first login
    if (user.must_change_password) {
      return res.json({
        forcePasswordChange: true,
        userId: user.id,
        email: user.email,
        role: user.role,
      });
    }

    // ---------------------------------------------
    // SINGLE SESSION ENFORCEMENT
    // ---------------------------------------------
    const newSessionToken = crypto.randomUUID();

    await pool.query(
      `UPDATE users SET session_token=$1 WHERE id=$2`,
      [newSessionToken, user.id]
    );

    // ---------------------------------------------
    // REFRESH TOKEN ROTATION
    // ---------------------------------------------
    const refreshToken = generateRefreshToken(user);

    await pool.query(
      `UPDATE users SET refresh_token=$1 WHERE id=$2`,
      [refreshToken, user.id]
    );

    const accessToken = generateAccessToken({
      ...user,
      session_token: newSessionToken,
    });

    return res.json({
      accessToken,
      refreshToken,
      email: user.email,
      role: user.role,
      forcePasswordChange: false,
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// ==========================================================
// REFRESH TOKEN - VALIDATES SESSION & ROTATION
// ==========================================================
const refresh = async (req, res) => {
  const { refresh_token } = req.body;

  if (!refresh_token)
    return res.status(401).json({ error: "Refresh token required" });

  try {
    const decoded = jwt.verify(refresh_token, process.env.REFRESH_SECRET);

    const { rows } = await pool.query(`SELECT * FROM users WHERE id=$1`, [
      decoded.id,
    ]);

    if (rows.length === 0)
      return res.status(403).json({ error: "User not found" });

    const user = rows[0];

    // Compare with DB-stored refresh token
    if (user.refresh_token !== refresh_token)
      return res.status(403).json({ error: "Refresh token invalidated" });

    // Generate new access token using current session token
    const newAccessToken = generateAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
      session_token: user.session_token,
    });

    return res.json({ accessToken: newAccessToken });
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }
};

// ==========================================================
// CHANGE PASSWORD
// ==========================================================
const changePassword = async (req, res) => {
  try {
    const { email, old_password, new_password } = req.body;

    if (!email || !old_password || !new_password)
      return res.status(400).json({ error: "All fields required" });

    const { rows } = await pool.query(`SELECT * FROM users WHERE email=$1`, [
      email,
    ]);

    if (rows.length === 0)
      return res.status(404).json({ error: "User not found" });

    const user = rows[0];

    const match = await bcrypt.compare(old_password, user.password);
    if (!match)
      return res.status(401).json({ error: "Old password incorrect" });

    const hashed = await bcrypt.hash(new_password, 10);

    await pool.query(
      `UPDATE users SET password=$1, must_change_password=FALSE WHERE email=$2`,
      [hashed, email]
    );

    return res.status(200).json({
      message: "Password updated successfully.",
    });
  } catch (err) {
    console.error("Change Password Error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ==========================================================
// SEND OTP
// ==========================================================
const sendOTP = async (req, res) => {
  try {
    const { email } = req.body;

    const { rows } = await pool.query(`SELECT * FROM users WHERE email=$1`, [
      email,
    ]);

    if (rows.length === 0)
      return res.status(404).json({ error: "Email not found" });

    const otp = Math.floor(100000 + Math.random() * 900000);
    const expiry = Date.now() + 2 * 60 * 1000;

    await pool.query(
      `UPDATE users SET otp=$1, otp_expiry=$2 WHERE email=$3`,
      [otp, expiry, email]
    );

    await transporter.sendMail({
      from: process.env.SMTP_EMAIL,
      to: email,
      subject: "Password Reset OTP",
      html: `<h2>Your OTP: ${otp}</h2><p>Expires in 2 minutes.</p>`,
    });

    return res.json({ message: "OTP sent to email." });
  } catch (err) {
    res.status(500).json({ error: "Failed to send OTP" });
  }
};

const resendOTP = (req, res) => sendOTP(req, res);

// ==========================================================
// VERIFY OTP
// ==========================================================
const verifyOTP = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    const { rows } = await pool.query(
      `SELECT otp, otp_expiry FROM users WHERE email=$1`,
      [email]
    );

    if (rows.length === 0)
      return res.status(404).json({ error: "Email not found" });

    const user = rows[0];

    if (user.otp !== otp.toString())
      return res.status(400).json({ error: "Invalid OTP" });

    if (Date.now() > user.otp_expiry)
      return res.status(400).json({ error: "OTP expired" });

    const hashed = await bcrypt.hash(newPassword, 10);

    await pool.query(
      `UPDATE users SET password=$1, otp=NULL, otp_expiry=NULL WHERE email=$2`,
      [hashed, email]
    );

    return res.json({ message: "Password reset successful" });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

// ==========================================================
// GET USERS
// ==========================================================
const getUsers = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, role, must_change_password 
       FROM users 
       ORDER BY id ASC`
    );

    return res.json({ users: result.rows });
  } catch (err) {
    console.error("Get Users Error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ==========================================================
// DELETE USER
// ==========================================================
const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const requestingUserId = req.user?.id;

    if (!id) return res.status(400).json({ error: "User ID required" });

    if (parseInt(id) === requestingUserId)
      return res.status(403).json({ error: "You cannot delete yourself" });

    const { rowCount } = await pool.query(`DELETE FROM users WHERE id=$1`, [
      id,
    ]);

    if (rowCount === 0)
      return res.status(404).json({ error: "User not found" });

    return res.json({ message: "User deleted successfully" });
  } catch (err) {
    console.error("Delete User Error:", err);
    res.status(500).json({ error: "Server error" });
  }
};

// ==========================================================
// EXPORT ALL
// ==========================================================
module.exports = {
  register,
  login,
  refresh,
  changePassword,
  sendOTP,
  resendOTP,
  verifyOTP,
  getUsers,
  deleteUser,
};
