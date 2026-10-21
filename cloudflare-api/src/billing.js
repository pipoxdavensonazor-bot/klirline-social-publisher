const STRIPE_API = "https://api.stripe.com/v1";
const STRIPE_API_VERSION = "2026-02-25.clover";

export async function stripeRequest(env, path, fields) {
  if (!env.STRIPE_SECRET_KEY) throw new Error("stripe-not-configured");
  const response = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Stripe-Version": STRIPE_API_VERSION,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: fields.toString()
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`stripe-request-failed:${response.status}`);
  return data;
}

export async function createCheckoutSession(env, org, email) {
  if (!env.STRIPE_PRICE_ID) throw new Error("stripe-price-not-configured");
  if (env.STRIPE_AUTOMATIC_TAX_ENABLED !== "true") throw new Error("stripe-tax-not-configured");
  const fields = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": env.STRIPE_PRICE_ID,
    "line_items[0][quantity]": "1",
    client_reference_id: org.id,
    "metadata[org_id]": org.id,
    "subscription_data[metadata][org_id]": org.id,
    success_url: `${env.FRONTEND_ORIGIN}/?billing=success`,
    cancel_url: `${env.FRONTEND_ORIGIN}/?billing=cancelled`,
    "automatic_tax[enabled]": "true",
    "billing_address_collection": "required",
    "tax_id_collection[enabled]": "true"
  });
  if (org.stripe_customer_id) fields.set("customer", org.stripe_customer_id);
  else fields.set("customer_email", email);
  return stripeRequest(env, "/checkout/sessions", fields);
}

export async function createPortalSession(env, org) {
  if (!org.stripe_customer_id) throw new Error("stripe-customer-not-found");
  const fields = new URLSearchParams({
    customer: org.stripe_customer_id,
    return_url: `${env.FRONTEND_ORIGIN}/?section=preferences`
  });
  return stripeRequest(env, "/billing_portal/sessions", fields);
}

function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] || 0) ^ (b[i] || 0);
  return diff === 0;
}

export async function verifyStripeSignature(rawBody, header, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret || !header) return false;
  const parts = header.split(",").map((item) => item.split("=", 2));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || !/^\d+$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > 300 || !signatures.length) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`)));
  const expected = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return signatures.some((signature) => constantTimeEqual(signature, expected));
}

export async function processStripeWebhook(env, db, request) {
  if (!env.STRIPE_WEBHOOK_SECRET) throw Object.assign(new Error("stripe-webhook-not-configured"), { status: 503 });
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 1024 * 1024) throw Object.assign(new Error("stripe-event-too-large"), { status: 413 });
  const signature = request.headers.get("Stripe-Signature") || "";
  if (!await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET)) throw Object.assign(new Error("stripe-signature-invalid"), { status: 400 });
  let event;
  try { event = JSON.parse(rawBody); } catch { throw Object.assign(new Error("stripe-event-invalid"), { status: 400 }); }
  if (!event.id || !Number.isSafeInteger(event.created) || !event.type || !event.data?.object) throw Object.assign(new Error("stripe-event-invalid"), { status: 400 });

  const inserted = await db.prepare("INSERT OR IGNORE INTO stripe_events(id,processed_at) VALUES(?,?)").bind(event.id, new Date().toISOString()).run();
  if (!inserted.meta?.changes) return { received: true, duplicate: true };

  const object = event.data.object;
  let orgId = object.metadata?.org_id || null;
  let customerId = typeof object.customer === "string" ? object.customer : object.customer?.id || null;
  let subscriptionId = object.id?.startsWith("sub_") ? object.id : (typeof object.subscription === "string" ? object.subscription : object.subscription?.id || null);
  let status = null;
  let periodStart = object.current_period_start ? new Date(object.current_period_start * 1000).toISOString() : null;
  let periodEnd = object.current_period_end ? new Date(object.current_period_end * 1000).toISOString() : null;

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    orgId ||= object.client_reference_id || null;
    if (object.payment_status !== "paid" && object.payment_status !== "no_payment_required") return { received: true, ignored: true };
    status = "active";
  } else if (event.type === "checkout.session.async_payment_failed") {
    orgId ||= object.client_reference_id || null;
    status = "past_due";
  } else if (event.type.startsWith("customer.subscription.")) {
    status = object.status === "active" || object.status === "trialing" ? "active" : object.status === "past_due" ? "past_due" : object.status === "unpaid" ? "unpaid" : "canceled";
  } else if (event.type === "invoice.paid") {
    status = "active";
  } else if (event.type === "invoice.payment_failed") {
    status = "past_due";
  } else {
    return { received: true, ignored: true };
  }

  if (!orgId && customerId) orgId = (await db.prepare("SELECT id FROM organizations WHERE stripe_customer_id=?").bind(customerId).first())?.id || null;
  if (!orgId && subscriptionId) orgId = (await db.prepare("SELECT id FROM organizations WHERE stripe_subscription_id=?").bind(subscriptionId).first())?.id || null;
  if (!orgId) return { received: true, ignored: true };

  await db.prepare(`UPDATE organizations SET billing_status=?,
    stripe_customer_id=COALESCE(?,stripe_customer_id),
    stripe_subscription_id=COALESCE(?,stripe_subscription_id),
    billing_period_start=COALESCE(?,billing_period_start),
    billing_period_end=COALESCE(?,billing_period_end),
    billing_event_created=?
    WHERE id=? AND billing_event_created<=?`)
    .bind(status, customerId, subscriptionId, periodStart, periodEnd, event.created, orgId, event.created).run();
  return { received: true };
}
