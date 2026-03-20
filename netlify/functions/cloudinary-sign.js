const crypto = require("crypto");
const jwt = require("jsonwebtoken");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };

  let token, category;
  try { ({ token, category } = JSON.parse(event.body)); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Corps invalide" }) }; }

  /* Vérifier JWT */
  let payload;
  try {
    payload = jwt.verify(token, process.env.OTP_SECRET);
  } catch {
    return { statusCode: 401, body: JSON.stringify({ error: "Session expirée" }) };
  }

  /* Vérifier niveau d'accès */
  const niveau = payload.niveau || 0;
  const isAdmin = payload.role === "admin";
  const READONLY = ["once"];

  if (READONLY.includes(category)) {
    return { statusCode: 403, body: JSON.stringify({ error: "Cet album est géré par les mariés" }) };
  }
  if (!isAdmin) {
    if (category === "ck1" && niveau < 2) return { statusCode: 403, body: JSON.stringify({ error: "Accès non autorisé" }) };
    if (category === "ck2" && niveau < 3) return { statusCode: 403, body: JSON.stringify({ error: "Accès non autorisé" }) };
  }

  /* Nom uploader */
  const uploaderName = isAdmin ? "Admin" : (payload.prenom || "Invité");

  /* Paramètres Cloudinary */
  const timestamp = Math.round(Date.now() / 1000);
  const folder = `mariage-lynda-mc/${category}`;
  const context = `uploader=${uploaderName}`;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  /* Signature HMAC-SHA1 */
  const toSign = `context=${context}&folder=${folder}&timestamp=${timestamp}${apiSecret}`;
  const signature = crypto.createHash("sha1").update(toSign).digest("hex");

  return {
    statusCode: 200,
    body: JSON.stringify({
      signature,
      timestamp,
      folder,
      context,
      api_key: process.env.CLOUDINARY_API_KEY,
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    }),
  };
};
