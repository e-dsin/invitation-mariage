const jwt = require("jsonwebtoken");
const https = require("https");

function httpsGet(url, headers) {
  return new Promise(function(resolve, reject) {
    const parsed = require("url").parse(url);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.path,
      headers: headers
    };
    https.get(opts, function(res) {
      let data = "";
      res.on("data", function(chunk) { data += chunk; });
      res.on("end", function() {
        if (res.statusCode >= 400) {
          reject(new Error("Cloudinary API " + res.statusCode + ": " + data));
        } else {
          try { resolve(JSON.parse(data)); }
          catch(e) { reject(new Error("JSON parse error: " + data)); }
        }
      });
    }).on("error", reject);
  });
}

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
  const folder    = "mariage-lynda-mc/" + category;
  const auth      = Buffer.from(apiKey + ":" + apiSecret).toString("base64");

  try {
    const url = "https://api.cloudinary.com/v1_1/" + cloudName + "/resources/image?type=upload&prefix=" + encodeURIComponent(folder + "/") + "&max_results=100&context=true";
    console.log("cloudinary-list folder:", folder);
    console.log("cloudinary-list url:", url);

    const data = await httpsGet(url, { "Authorization": "Basic " + auth });
    console.log("cloudinary-list count:", (data.resources || []).length);
    if (data.resources && data.resources.length > 0) {
      console.log("cloudinary-list first public_id:", data.resources[0].public_id);
    }

    const photos = (data.resources || []).map(function(r) {
      return {
        id:          r.public_id,
        c:           category,
        uploader:    (r.context && r.context.custom && r.context.custom.uploader) || "",
        thumbnailUrl: r.secure_url.replace("/upload/", "/upload/w_400,h_400,c_fill,q_auto,f_auto/"),
        fullUrl:     r.secure_url.replace("/upload/", "/upload/q_auto,f_auto/"),
        createdTime: r.created_at,
      };
    });

    photos.sort(function(a, b) { return b.createdTime.localeCompare(a.createdTime); });
    return { statusCode: 200, body: JSON.stringify({ photos }) };
  } catch (err) {
    console.error("cloudinary-list error:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};