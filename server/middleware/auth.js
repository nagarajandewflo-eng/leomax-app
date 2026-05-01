const jwt = require("jsonwebtoken");
const pool = require("../db");

const JWT_SECRET = process.env.JWT_SECRET;

// ============================================================
// 🔐 AUTHENTICATE TOKEN (Access Token → 1 hour)
// ============================================================
async function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  console.log("🔐 [Auth] Authorization header:", authHeader);

  const token = authHeader?.split(" ")[1];

  if (!token) {
    console.warn("⚠️ [Auth] No token provided");
    return res.status(401).json({ error: "No token provided" });
  }

  // Quick sanity check: JWTs have 3 parts separated by '.'
  if (token.split(".").length !== 3) {
    console.warn("⚠️ [Auth] Malformed token:", token);
    return res.status(401).json({ error: "Malformed token" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log("✅ [Auth] Token decoded:", decoded);

    // ============================================================
    // 🚫 SINGLE SESSION CHECK — FIXED (pg returns object, not array)
    // ============================================================
    const result = await pool.query(
      "SELECT session_token FROM users WHERE id = $1",
      [decoded.id]
    );

    const rows = result.rows; // actual rows array

    if (!rows.length) {
      console.warn("🚫 [Auth] User not found in DB");
      return res.status(401).json({ error: "User not found" });
    }

    const dbSession = rows[0].session_token;

    if (!dbSession || dbSession !== decoded.session_token) {
      console.warn("🚫 [Auth] Session token mismatch → Another login detected");
      return res.status(401).json({
        error:
          "Session expired. You have logged in from another device. Please login again.",
      });
    }

    // Attach user to request
    req.user = decoded;
    next();
  } catch (err) {
    console.error("❌ [Auth] Token verification failed:", err);

    // Better error messaging
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired" });
    } else if (err.name === "JsonWebTokenError") {
      return res.status(401).json({ error: "Invalid token" });
    }

    return res.status(403).json({ error: "Token verification failed" });
  }
}

// ============================================================
// 🔑 AUTHORIZE ROLES
// ============================================================
function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    console.log(
      "🔑 [Role Check] Required:",
      allowedRoles,
      "User role:",
      req.user?.role
    );

    if (!req.user || !allowedRoles.includes(req.user.role)) {
      console.warn("🚫 [Role Check] Access denied for:", req.user?.role);
      return res
        .status(403)
        .json({ error: "Forbidden. You do not have the required permissions." });
    }

    console.log("✅ [Role Check] Access granted to:", req.user.role);
    next();
  };
}

module.exports = { authenticateToken, authorizeRoles };
