const https = require("https");

function httpsGet(url) {
  return new Promise(function(resolve, reject) {
    const parsed = require("url").parse(url);
    https.get({ hostname: parsed.hostname, path: parsed.path, headers: { "User-Agent": "Node.js" } }, function(res) {
      let data = "";
      res.on("data", function(chunk) { data += chunk; });
      res.on("end", function() {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error("JSON parse error")); }
      });
    }).on("error", reject);
  });
}

async function geolocate(ip) {
  try {
    const cleanIp = ip.split(",")[0].trim();
    /* Ignorer les IPs privées */
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|127\.)/.test(cleanIp)) {
      return { lat: null, lon: null, city: "IP privée", country: "", status: "private" };
    }
    const data = await httpsGet(
      `http://ip-api.com/json/${encodeURIComponent(cleanIp)}?fields=lat,lon,status,city,country,regionName`
    );
    if (data.status === "success") {
      return { lat: data.lat, lon: data.lon, city: data.city||"", region: data.regionName||"", country: data.country||"", status: "success" };
    }
    return { lat: null, lon: null, city: "", region: "", country: "", status: "fail" };
  } catch(e) {
    return { lat: null, lon: null, city: "", region: "", country: "", status: "error" };
  }
}

function pause(ms) { return new Promise(function(r){ setTimeout(r, ms); }); }

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };

  let ips;
  try { ({ ips } = JSON.parse(event.body)); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Corps invalide" }) }; }

  if (!Array.isArray(ips) || ips.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: "Liste IPs vide" }) };
  }

  const results = {};
  /* Séquentiel avec pause 1.4s pour respecter la limite 45 req/min */
  for (let i = 0; i < ips.length; i++) {
    const ip = ips[i];
    if (!results[ip]) {
      results[ip] = await geolocate(ip);
      if (i < ips.length - 1) await pause(1400);
    }
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ results }),
  };
};