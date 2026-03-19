const crypto = require("crypto");
const jwt = require("jsonwebtoken");

function verifySignedOTP(signed, otpInput, phone) {
  const secret = process.env.OTP_SECRET;
  const parts = signed.split(":");
  if (parts.length !== 4) return { valid: false, reason: "Format invalide" };

  const [otp, storedPhone, expires, sig] = parts;
  const payload = `${otp}:${storedPhone}:${expires}`;
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex")
    .slice(0, 16);

  if (sig !== expectedSig) return { valid: false, reason: "Token falsifié" };
  if (Date.now() > parseInt(expires)) return { valid: false, reason: "Code expiré" };
  if (storedPhone !== phone) return { valid: false, reason: "Numéro incorrect" };
  if (otp !== otpInput.trim()) return { valid: false, reason: "Code incorrect" };

  return { valid: true };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };

  let phone, otp, signed;
  try { ({ phone, otp, signed } = JSON.parse(event.body)); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Corps invalide" }) }; }

  const clean = (phone || "").replace(/\s/g, "");
  const adminPhone = process.env.ADMIN_PHONE;

  if (clean !== adminPhone) {
    return { statusCode: 403, body: JSON.stringify({ error: "Numéro non autorisé" }) };
  }

  const result = verifySignedOTP(signed, otp, clean);
  if (!result.valid) {
    return { statusCode: 401, body: JSON.stringify({ error: result.reason }) };
  }

  const token = jwt.sign(
    { role: "admin", phone: clean },
    process.env.OTP_SECRET,
    { expiresIn: "4h" }
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, token }),
  };
};
