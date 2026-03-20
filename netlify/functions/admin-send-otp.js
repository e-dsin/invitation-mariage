const twilio = require("twilio");

const OTP_VALIDITY_MS = 10 * 60 * 1000;

// Stockage temporaire en mémoire (fonctionne pour un seul admin)
// En serverless chaque invocation est indépendante → on utilise une variable d'env temporaire
// Solution simple : stocker OTP dans process.env via un fichier .env ou dans un KV store
// Ici on utilise une approche simple : OTP signé dans le token lui-même (stateless)

const crypto = require("crypto");

function generateOTP() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function signOTP(otp, phone) {
  const secret = process.env.OTP_SECRET;
  const expires = Date.now() + OTP_VALIDITY_MS;
  const payload = `${otp}:${phone}:${expires}`;
  const sig = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex")
    .slice(0, 16);
  return `${payload}:${sig}`;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };

  let phone;
  try { ({ phone } = JSON.parse(event.body)); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Corps invalide" }) }; }

  const adminPhones = process.env.ADMIN_PHONE;
  if (!adminPhones) return { statusCode: 500, body: JSON.stringify({ error: "Admin non configuré" }) };

  const clean = (phone || "").replace(/\s/g, "");
  if (!adminPhones.includes(clean)) {
    return { statusCode: 403, body: JSON.stringify({ error: "Numéro non autorisé" }) };
  }

  try {
    const otp = generateOTP();
    const signed = signOTP(otp, clean);

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const toWA = clean.startsWith("whatsapp:") ? clean : `whatsapp:${clean}`;

    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM,
      to: toWA,
      body: `🔐 Code admin — Invitation Lynda & Marcel-Cédric\n\n*${otp}*\n\nValable 10 minutes.`,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, signed }),
    };
  } catch (err) {
    console.error("admin-send-otp error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Erreur envoi WhatsApp" }) };
  }
};
