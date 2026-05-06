const geoip = require("geoip-lite");

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
  const unique = [...new Set(ips.map(ip => ip.split(",")[0].trim()))];

  for (const ip of unique) {
    /* Ignorer IPs privées */
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|127\.|::1$)/.test(ip)) {
      results[ip] = { lat: null, lon: null, city: "IP privée", country: "", region: "" };
      continue;
    }
    const geo = geoip.lookup(ip);
    if (geo && geo.ll) {
      results[ip] = {
        lat:     geo.ll[0],
        lon:     geo.ll[1],
        city:    geo.city    || "",
        region:  geo.region  || "",
        country: geo.country || "",
      };
    } else {
      results[ip] = { lat: null, lon: null, city: "", region: "", country: "" };
    }
  }
  
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ results }),
  };
};