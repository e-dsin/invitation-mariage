const jwt = require("jsonwebtoken");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };

  let token, category;
  try { ({ token, category } = JSON.parse(event.body)); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Corps invalide" }) }; }

  let payload;
  try {
    payload = jwt.verify(token, process.env.OTP_SECRET);
  } catch {
    return { statusCode: 401, body: JSON.stringify({ error: "Session expirée" }) };
  }

  const niveau = payload.niveau || 0;
  const isAdmin = payload.role === "admin";
  if (!isAdmin) {
    if (category === "ck1" && niveau < 2) return { statusCode: 403, body: JSON.stringify({ error: "Accès non autorisé" }) };
    if (category === "ck2" && niveau < 3) return { statusCode: 403, body: JSON.stringify({ error: "Accès non autorisé" }) };
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey    = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const folder    = `mariage-lynda-mc/${category}`;

  try {
    /* Cloudinary Admin API — liste les ressources du dossier */
    const url = `https://api.cloudinary.com/v1_1/${cloudName}/resources/image?prefix=${encodeURIComponent(folder)}/&max_results=100&context=true`;
    const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");

    const res = await fetch(url, {
      headers: { "Authorization": `Basic ${auth}` }
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Cloudinary API error: ${err}`);
    }

    const data = await res.json();
    const photos = (data.resources || []).map((r) => ({
      id:           r.public_id,
      c:            category,
      uploader:     (r.context && r.context.custom && r.context.custom.uploader) || "",
      thumbnailUrl: r.secure_url.replace("/upload/", "/upload/w_400,h_400,c_fill,q_auto,f_auto/"),
      fullUrl:      r.secure_url.replace("/upload/", "/upload/q_auto,f_auto/"),
      createdTime:  r.created_at,
    }));

    /* Trier du plus récent au plus ancien */
    photos.sort(function(a, b){ return b.createdTime.localeCompare(a.createdTime); });

    return { statusCode: 200, body: JSON.stringify({ photos }) };
  } catch (err) {
    console.error("cloudinary-list error:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
