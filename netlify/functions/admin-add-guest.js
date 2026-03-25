const { google } = require("googleapis");
const jwt = require("jsonwebtoken");
const twilio = require("twilio");
const crypto = require("crypto");

const SHEET_ID = process.env.GOOGLE_SHEETS_ID;
const OTP_VALIDITY_MS = 10 * 60 * 1000;

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

function generateOTP() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function generateGuestToken() {
  return crypto.randomBytes(24).toString("hex");
}

async function phoneExists(sheets, phone) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "Invités!B:B",
  });
  const rows = res.data.values || [];
  return rows.some((r) => (r[0] || "").replace(/\s/g, "") === phone);
}

async function addGuest(sheets, prenom, phone, niveau) {
  const otp = generateOTP();
  const expires = Date.now() + OTP_VALIDITY_MS;
  const guestToken = generateGuestToken();
  const siteUrl = process.env.SITE_URL || "https://votre-site.netlify.app";
  const inviteUrl = `${siteUrl}?t=${guestToken}`;

  /* Colonnes : A=prenom B=tel C=niveau D=otp E=expires F=rsvp_presence G=rsvp_regime
     H=rsvp_message I=rsvp_date J=rsvp_ck1 K=rsvp_ck2 L=guest_token */
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: "Invités!A:L",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[prenom, phone, String(niveau), otp, String(expires), "", "", "", "", "", "", guestToken]],
    },
  });

  return { guestToken, inviteUrl };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };

  let adminToken, prenom, phone, niveau;
  try { ({ token: adminToken, prenom, phone, niveau } = JSON.parse(event.body)); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Corps invalide" }) }; }

  try {
    const payload = jwt.verify(adminToken, process.env.OTP_SECRET);
    if (payload.role !== "admin") throw new Error("Not admin");
  } catch {
    return { statusCode: 401, body: JSON.stringify({ error: "Session admin expirée ou invalide" }) };
  }

  if (!prenom || prenom.trim().length < 2) return { statusCode: 400, body: JSON.stringify({ error: "Prénom invalide" }) };
  if (!phone || !/^\+[1-9]\d{6,14}$/.test(phone.replace(/\s/g, ""))) return { statusCode: 400, body: JSON.stringify({ error: "Numéro invalide (format +336...)" }) };
  const niv = parseInt(niveau);
  if (![1, 2, 3, 4].includes(niv)) return { statusCode: 400, body: JSON.stringify({ error: "Niveau invalide (1, 2, 3 ou 4)" }) };
  const cleanPhone = phone.replace(/\s/g, "");

  try {
    const sheets = await getSheetsClient();
    const exists = await phoneExists(sheets, cleanPhone);
    if (exists) return { statusCode: 409, body: JSON.stringify({ error: "Ce numéro est déjà dans la liste" }) };

    const { inviteUrl } = await addGuest(sheets, prenom.trim(), cleanPhone, niv);

    /* Envoi SMS avec le lien d'invitation */
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages.create({
      from: process.env.TWILIO_SMS_FROM,
      to: cleanPhone,
      body: `Bonjour ${prenom.trim()} 🌸\n\nLynda & Marcel-Cédric ont le bonheur de vous annoncer leur mariage et seraient touchés de vous avoir à leurs côtés pour célébrer ce jour si précieux.\n\nVotre invitation personnelle :\n${inviteUrl}\n\n— Avec tout leur amour 🤍`,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        inviteUrl,
        message: `${prenom.trim()} ajouté(e) — SMS envoyé`,
      }),
    };
    
    
  } catch (err) {
    console.error("admin-add-guest error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: "Erreur serveur : " + err.message }) };
  }
};
