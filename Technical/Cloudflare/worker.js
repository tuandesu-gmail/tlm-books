export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // --- CORS preflight ---
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeadersFromReq(req) });
    }

    // Ping Dodo upstream (debug)
    if (url.pathname === "/_debug/dodo") {
      const upstream = `${env.DODO_API_BASE}/checkouts`;
      const r = await fetch(upstream, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json",
          "authorization": `Bearer ${env.DODO_API_KEY_LIVE || ""}`,
        },
        body: JSON.stringify({ ping: true })
      });
      const ct = r.headers.get("content-type") || "";
      const text = await r.text();
      return new Response(
        JSON.stringify({
          request_to: upstream,
          status: r.status,
          content_type: ct,
          body_sample: text.slice(0, 800)
        }, null, 2),
        { headers: { "content-type": "application/json", ...corsHeadersFromReq(req) } }
      );
    }

    // ===== ROUTES =====
    if (url.pathname === "/thankyou") return thankyouPage(url, env);
    if (url.pathname === "/issue" && req.method === "POST") return issueToken(req, env);
    if (url.pathname === "/download") return downloadFile(url, env);

    if (url.pathname === "/dodo/create-checkout" && req.method === "POST") {
      return createDodoCheckout(req, env);
    }

    return new Response("Not found", { status: 404 });
  }
};

/** ============ CONFIG ============ **/
const TTL_MINUTES = 60 * 24; // 24h

/** ============ HELPERS ============ **/
function randomId() {
  return crypto.randomUUID().replace(/-/g, "");
}

function corsHeadersFromReq(req) {
  const origin = req.headers.get('Origin') || '*';
  const acrh = req.headers.get('Access-Control-Request-Headers') || 'Content-Type, Authorization';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': acrh,
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin, Access-Control-Request-Headers',
  };
}

function corsAllowShopify(req) {
  const allow = new Set([
    'https://books.thelivesmedia.com',
    'https://books.theepochmedia.com' // tạm thời cho giai đoạn chuyển
  ]);
  const origin = req.headers.get('Origin') || '';
  const allowed = allow.has(origin) ? origin : 'https://books.thelivesmedia.com';
  const acrh = req.headers.get('Access-Control-Request-Headers') || 'Content-Type, Authorization';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': acrh,
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin, Access-Control-Request-Headers',
  };
}


async function getTitle(env, sku) {
  if (env.PRODUCT_TITLES) {
    const t = await env.PRODUCT_TITLES.get(sku);
    if (t) return t;
  }
  const fallback = (await getFilename(env, sku)) || sku;
  const base = fallback.replace(/\.zip$/i, "").replace(/[_]+/g, " ").trim();
  return base.replace(/\b([a-z])/gi, (m, c) => c.toUpperCase());
}

async function getFilename(env, sku) {
  if (env.EBOOK_PRODUCTS) {
    const f = await env.EBOOK_PRODUCTS.get(sku);
    if (f) return f;
  }
  return null;
}

function normalizeOrderName(v) {
  v = (v || '').trim();
  if (!v) return v;
  return v[0] === '#' ? v : ('#' + v);
}

/** ============ /thankyou (no Shopify) ============ **/
async function thankyouPage(url, env) {
  const orderInput = url.searchParams.get("order") || "";           // optional 
  const emailInput = (url.searchParams.get("email") || "").trim();  // optional

  // skus = required
  const rawSkus = url.searchParams.get("skus");
  const skus = (rawSkus || "")
    .split(",")
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);

  if (!skus.length) {
    return new Response("Missing 'skus' query param", { status: 400 });
  }

  // Title map từ KV
  const pairs = await Promise.all(skus.map(async sku => [sku, await getTitle(env, sku)]));
  const TITLE_MAP = Object.fromEntries(pairs);

  const note = skus.length > 1
    ? 'Click “Download Now” for each ebook. The links remain valid for 24 hours.'
    : 'Click “Download Now” to get your ebook. The link remains valid for 24 hours.';

  const logo =
    (env.THANKYOU_LOGO_URL && String(env.THANKYOU_LOGO_URL)) ||
    "https://thelivesmedia.com/wp-content/uploads/2025/09/cropped-TheLivesMedia_logo_540x148-300x82.png";

  const css = `
  :root{--brand:#d9a528;--ink:#111;--muted:#666;--bg:#fafafa}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);font:16px/1.6 system-ui,Segoe UI,Roboto,Helvetica,Arial;color:var(--ink)}
  .wrap{max-width:960px;margin:0 auto;padding:20px}
  .brand{display:flex;justify-content:center}
  .brand img{height:76px}
  .spacer{height:50px}
  .card{background:#fff;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.08);padding:32px;margin:0 auto}
  header{display:flex;align-items:center;gap:12px;margin-bottom:8px}
  h1{margin:6px 0 2px;font-size:32px;line-height:1.2}
  .badge{font-size:12px;color:#777;margin-left:8px}
  p.note{color:var(--muted);margin:0}
  .lead{margin:18px 0 8px}
  ul{list-style:none;margin:0;padding:0}
  li.item{display:block;padding:18px 0;border-top:1px solid #eee}
  li.item:first-child{border-top:0}
  .sku{font-weight:700;margin-bottom:10px}
  .btn{font-size:16px;display:inline-block;background:var(--brand);color:#fff;border:0;border-radius:12px;padding:12px 18px;font-weight:500;cursor:pointer}
  .btn:hover{filter:brightness(.93)}
  .btn[disabled]{opacity:.6;cursor:not-allowed}
  .msg{font-size:14px;margin-top:6px;color:var(--muted)}
  .msg.err{color:#c0392b}
  footer{margin-top:24px;color:var(--muted);font-size:13px;text-align:center}
  @media (max-width: 640px){
    body{font-size:15px}
    .wrap{padding:16px}
    .card{padding:22px;border-radius:14px}
    h1{font-size:24px}
    .brand img{height:62px}
    .btn{width:100%;text-align:center}
  }`;

  const items = await Promise.all(skus.map(async (sku) => {
    const fn = await getFilename(env, sku);
    const disabled = fn ? "" : "disabled";
    const hint = fn ? "" : `<div class="msg err">Missing filename for ${sku}. Add it to KV 'EBOOK_PRODUCTS'.</div>`;
    return `
      <li class="item">
        <div class="sku">${TITLE_MAP[sku] || sku}</div>
        ${hint}
        <button class="btn" ${disabled} onclick="downloadNow('${sku}')" id="btn-${sku}">Download Now</button>
        <div id="msg-${sku}" class="msg"></div>
      </li>`;
  }));

  const html = `<!doctype html><html lang="en"><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Thank you – THE LIVES MEDIA</title>
  <link rel="icon" href="https://thelivesmedia.com/wp-content/uploads/2025/09/cropped-TheLivesMedia_icon_100x100-192x192.png" sizes="192x192" />
  <style>${css}</style>
  <body>
    <div class="wrap">
      <div class="card">
        <div class="brand"><img src="${logo}" alt="The Lives Media" loading="lazy" decoding="async" /></div>
        <div class="spacer"></div>
        <header>
          <div>
            <h1>Payment successful ✅</h1>
            <p class="note">
              ${orderInput ? `Order <strong>${normalizeOrderName(orderInput)}</strong>` : ''}
              ${emailInput ? `${orderInput ? ' · ' : ''}sent to <strong>${emailInput}</strong>` : ''}
            </p>
          </div>
        </header>
        <p class="lead">${note}</p>
        <ul>${items.join("")}</ul>
        <footer>Need help? Contact <a href="mailto:editor@thelivesmedia.com">editor@thelivesmedia.com</a></footer>
      </div>
    </div>
    <script>
      async function downloadNow(sku){
        const r = await fetch('/issue', {
          method:'POST',
          headers:{'content-type':'application/json'},
          body: JSON.stringify({ orderId: "${normalizeOrderName(orderInput)}", email: "${emailInput}", sku })
        });
        const data = await r.json();
        if(!r.ok){ alert(data.error || 'Error'); return; }
        location.href = data.url;
      }
    </script>
  </body></html>`;

  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

/** ============ issue / download ============ **/
async function issueToken(req, env) {
  const { orderId, email, sku } = await req.json();
  if (!sku) return Response.json({ error: "Missing SKU" }, { status: 400, headers: corsAllowShopify(req) });

  const filename = await getFilename(env, sku);
  if (!filename) return Response.json({ error: `No filename for SKU ${sku}` }, { status: 400, headers: corsAllowShopify(req) });

  const token = randomId();
  const exp = Date.now() + TTL_MINUTES * 60 * 1000;
  const meta = { orderId, email, sku, filename, exp };
  await env.TOKENS.put("t:"+token, JSON.stringify(meta), { expirationTtl: TTL_MINUTES*60 });

  const url = new URL("/download", req.url);
  url.searchParams.set("t", token);
  return Response.json({ url: url.toString(), exp }, { headers: corsAllowShopify(req) });
}

async function downloadFile(url, env) {
  const t = url.searchParams.get("t");
  if (!t) return new Response("Missing token", { status: 400 });

  const raw = await env.TOKENS.get("t:"+t);
  if (!raw) return new Response("Token invalid or expired", { status: 410 });

  const meta = JSON.parse(raw);
  if (Date.now() > meta.exp) return new Response("Token expired", { status: 410 });

  const obj = await env.EBOOKS_BUCKET.get(meta.filename);
  if (!obj) return new Response("File not found", { status: 404 });

  const fname = meta.filename.split("/").pop() || "ebook.zip";
  const headers = new Headers();
  headers.set("content-type", "application/zip");
  headers.set("content-disposition", `attachment; filename="${fname}"`);
  return new Response(obj.body, { headers });
}

/** ============ Dodo checkout (return_url / cancel_url) ============ **/
async function createDodoCheckout(req, env) {
  try {
    const { sku, dodo_product_id, email = "", affonso_referral = "", ref = "" } = await req.json();

    if (!dodo_product_id) {
      return Response.json(
        { error: "Missing dodo_product_id" },
        { status: 400, headers: corsAllowShopify(req) }
      );
    }

    const rawBase = env.BASE_DOWNLOAD_URL || "https://download.thelivesmedia.com";
    const base = rawBase.replace(/\/+$/, "");

    const orderId = "DODO-" + Math.random().toString(36).slice(2, 8).toUpperCase();

    const ty = new URL(base + "/thankyou");
    ty.searchParams.set("order", orderId);
    ty.searchParams.set("email", email);
    ty.searchParams.set("skus", sku);

    const cancel = new URL(base + "/cancel");
    cancel.searchParams.set("order", orderId);
    cancel.searchParams.set("email", email);
    cancel.searchParams.set("skus", sku);

    const payload = {
      product_cart: [{ product_id: dodo_product_id, quantity: 1 }],
      return_url: ty.toString(),
      cancel_url: cancel.toString(),
      metadata: { sku, affonso_referral: affonso_referral || "", ref: ref || "", order_id: orderId },
    };

    console.log("Dodo Checkout Payload:", JSON.stringify(payload));

    const upstream = "https://live.dodopayments.com/checkouts";
    const r = await fetch(upstream, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept": "application/json",
        "authorization": `Bearer ${env.DODO_API_KEY_LIVE || ""}`,
      },
      body: JSON.stringify(payload),
    });

    const isJson = r.headers.get("content-type")?.includes("application/json");
    const body = isJson ? await r.json() : await r.text();

    if (!r.ok) {
      return Response.json(
        {
          error: "Dodo upstream error",
          status: r.status,
          upstream,
          details: isJson ? body : String(body).slice(0, 500),
        },
        { status: r.status, headers: corsAllowShopify(req) }
      );
    }

    return Response.json(
      { checkout_url: body.checkout_url, checkout_id: body.session_id, order_id: orderId },
      { headers: corsAllowShopify(req) }
    );
  } catch (e) {
    return Response.json(
      { error: e.message || "Unexpected error" },
      { status: 500, headers: corsAllowShopify(req) }
    );
  }
}
