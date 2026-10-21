import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../src/index.js";

function fixture(overrides = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const migration of ["0001_initial.sql", "0002_login_limits.sql", "0003_idempotency_fingerprints.sql", "0004_billing_organizations.sql", "0005_plan_usage_limits.sql", "0006_stripe_event_order.sql", "0007_user_auth_version.sql"]) {
    sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
  }
  class Statement {
    constructor(sql) { this.sql = sql; this.params = []; }
    bind(...params) { this.params = params; return this; }
    first() { return sqlite.prepare(this.sql).get(...this.params) || null; }
    all() { return { results: sqlite.prepare(this.sql).all(...this.params) }; }
    run() { const result = sqlite.prepare(this.sql).run(...this.params); return { meta: { changes: Number(result.changes) } }; }
  }
  const DB = {
    prepare(sql) { return new Statement(sql); },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try { const result = statements.map((statement) => statement.run()); sqlite.exec("COMMIT"); return result; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    }
  };
  const objects = new Map();
  const MEDIA = {
    async put(key, value) { objects.set(key, value); },
    async get(key) { const body = objects.get(key); return body ? { body } : null; },
    async head(key) { return objects.has(key) ? { key } : null; },
    async delete(key) { objects.delete(key); }
  };
  const env = {
    DB, MEDIA, SESSION_SECRET: "s".repeat(48), TOKENS_ENCRYPTION_KEY_HEX: "a".repeat(64),
    BOOTSTRAP_ADMIN_KEY: "bootstrap-secret", FRONTEND_ORIGIN: "https://app.test", PUBLIC_BASE_URL: "https://api.test",
    LINKEDIN_CLIENT_ID: "client", LINKEDIN_CLIENT_SECRET: "secret", LINKEDIN_REDIRECT_URI: "https://api.test/oauth/linkedin/callback",
    LINKEDIN_ORGANIZATION_URN: "urn:li:organization:98765", LINKEDIN_VERSION: "202610", ...overrides
  };
  async function request(path, method = "GET", body = null, headers = {}) {
    const requestHeaders = new Headers(headers);
    requestHeaders.set("Origin", "https://app.test");
    if (method !== "GET") requestHeaders.set("X-Klirline-Request", "1");
    if (body && !(body instanceof FormData)) requestHeaders.set("Content-Type", "application/json");
    const req = new Request(`https://api.test${path}`, {
      method, headers: requestHeaders,
      body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined
    });
    return worker.fetch(req, env, { waitUntil() {} });
  }
  return { DB, MEDIA, env, objects, request, sqlite };
}

function base64url(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); }
async function testPasswordHash(password, saltBytes) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return base64url(new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: saltBytes, iterations: 310000, hash: "SHA-256" }, key, 256)));
}

async function bootstrap(ctx, email = "owner@klirline.ca") {
  const response = await ctx.request("/api/auth/register", "POST", { email, password: "a-secure-password-123" }, { "X-Klirline-Bootstrap": ctx.env.BOOTSTRAP_ADMIN_KEY });
  assert.equal(response.status, 201);
  return response.headers.get("set-cookie").split(";")[0];
}

test("auth, media, scheduling, publish idempotency, and account deletion", async () => {
  const ctx = fixture();
  assert.equal((await (await ctx.request("/api/health")).json()).ok, true);
  const cookie = await bootstrap(ctx);
  assert.equal((await ctx.request("/api/me", "GET", null, { Cookie: cookie })).status, 200);

  const invalidSchedule = await ctx.request("/api/scheduled", "POST", {
    text: "Klirline", targets: ["instagram"], mediaId: "missing", runAtUTC: new Date(Date.now() + 120000).toISOString()
  }, { Cookie: cookie });
  assert.equal(invalidSchedule.status, 404);

  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from([255, 216, 255, 0])], { type: "image/jpeg" }), "campaign.jpg");
  const upload = await ctx.request("/api/media", "POST", form, { Cookie: cookie });
  const media = await upload.json();
  assert.equal(upload.status, 201);
  assert.equal(ctx.objects.size, 1);

  ctx.sqlite.prepare("UPDATE media SET expires_at=? WHERE id=?").run(new Date(Date.now() + 60 * 60 * 1000).toISOString(), media.id);
  const expiringMediaSchedule = await ctx.request("/api/scheduled", "POST", {
    text: "Klirline", targets: ["instagram"], mediaId: media.id, runAtUTC: new Date(Date.now() + 58 * 60 * 1000).toISOString()
  }, { Cookie: cookie });
  assert.equal(expiringMediaSchedule.status, 400);
  assert.equal((await expiringMediaSchedule.json()).error, "scheduled-media-expires-too-soon");
  ctx.sqlite.prepare("UPDATE media SET expires_at=? WHERE id=?").run(new Date(Date.now() + 30 * 86400000).toISOString(), media.id);

  const schedule = { text: "Klirline", targets: ["instagram"], mediaId: media.id, runAtUTC: new Date(Date.now() + 120000).toISOString() };
  const queued = await ctx.request("/api/scheduled", "POST", schedule, { Cookie: cookie, "Idempotency-Key": "schedule-once" });
  const queuedJob = (await queued.json()).job;
  assert.equal(queuedJob.status, "queued");
  const replayedSchedule = await ctx.request("/api/scheduled", "POST", schedule, { Cookie: cookie, "Idempotency-Key": "schedule-once" });
  assert.equal((await replayedSchedule.json()).deduped, true);
  const scheduleConflict = await ctx.request("/api/scheduled", "POST", { ...schedule, text: "Different content" }, { Cookie: cookie, "Idempotency-Key": "schedule-once" });
  assert.equal(scheduleConflict.status, 409);

  const dueAt = new Date(Date.now() - 1000).toISOString();
  ctx.sqlite.prepare("UPDATE scheduled_posts SET run_at=? WHERE id=?").run(dueAt, queuedJob.id);
  ctx.sqlite.prepare("UPDATE scheduled_results SET next_run_at=? WHERE job_id=?").run(dueAt, queuedJob.id);
  const pending = [];
  await worker.scheduled({}, ctx.env, { waitUntil(promise) { pending.push(promise); } });
  await Promise.all(pending);
  const processedJobs = await (await ctx.request("/api/scheduled", "GET", null, { Cookie: cookie })).json();
  assert.equal(processedJobs.find((job) => job.id === queuedJob.id).status, "action-required");

  const cancelJob = await ctx.request("/api/scheduled", "POST", {
    text: "Annulation", targets: ["linkedin"], runAtUTC: new Date(Date.now() + 120000).toISOString()
  }, { Cookie: cookie, "Idempotency-Key": "cancel-once" });
  const cancelId = (await cancelJob.json()).job.id;
  const canceled = await ctx.request(`/api/scheduled/${encodeURIComponent(cancelId)}`, "DELETE", null, { Cookie: cookie });
  assert.equal((await canceled.json()).status, "canceled");

  const publish = await ctx.request("/api/publish", "POST", { text: "Klirline", targets: ["facebook"] }, { Cookie: cookie, "Idempotency-Key": "publish-once" });
  const result = await publish.json();
  assert.equal(result.results[0].status, "action-required");
  const replayedPublish = await ctx.request("/api/publish", "POST", { text: "Klirline", targets: ["facebook"] }, { Cookie: cookie, "Idempotency-Key": "publish-once" });
  assert.equal((await replayedPublish.json()).deduped, true);
  const publishConflict = await ctx.request("/api/publish", "POST", { text: "Different content", targets: ["facebook"] }, { Cookie: cookie, "Idempotency-Key": "publish-once" });
  assert.equal(publishConflict.status, 409);
  const unknownTarget = await ctx.request("/api/publish", "POST", { text: "Klirline", targets: ["facebook", "unknown-network"] }, { Cookie: cookie });
  assert.equal(unknownTarget.status, 400);

  const deletion = await ctx.request("/api/account", "DELETE", { password: "a-secure-password-123" }, { Cookie: cookie });
  assert.equal(deletion.status, 200);
  assert.equal(ctx.objects.size, 0);
  assert.equal(ctx.sqlite.prepare("SELECT COUNT(*) AS count FROM users").get().count, 0);
  assert.equal((await ctx.request("/api/me", "GET", null, { Cookie: cookie })).status, 401);
});

test("write requests reject missing origin and CSRF marker", async () => {
  const ctx = fixture();
  const response = await worker.fetch(new Request("https://api.test/api/auth/register", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Klirline-Bootstrap": "bootstrap-secret" },
    body: JSON.stringify({ email: "owner@klirline.ca", password: "a-secure-password-123" })
  }), ctx.env, { waitUntil() {} });
  assert.equal(response.status, 403);
});

test("password changes invalidate previous sessions and keep the current session active", async () => {
  const ctx = fixture();
  const oldCookie = await bootstrap(ctx);
  const deniedChange = await ctx.request("/api/auth/password", "POST", { currentPassword: "wrong-password", newPassword: "another-secure-password" }, { Cookie: oldCookie });
  assert.equal(deniedChange.status, 401);
  const changed = await ctx.request("/api/auth/password", "POST", { currentPassword: "a-secure-password-123", newPassword: "a-different-password-456" }, { Cookie: oldCookie });
  assert.equal(changed.status, 200);
  const newCookie = changed.headers.get("set-cookie").split(";")[0];
  assert.equal((await ctx.request("/api/me", "GET", null, { Cookie: newCookie })).status, 200);
  assert.equal((await ctx.request("/api/me", "GET", null, { Cookie: oldCookie })).status, 401);
  const oldPasswordLogin = await ctx.request("/api/auth/login", "POST", { email: "owner@klirline.ca", password: "a-secure-password-123" });
  assert.equal(oldPasswordLogin.status, 401);
  assert.equal((await ctx.request("/api/auth/login", "POST", { email: "owner@klirline.ca", password: "a-different-password-456" })).status, 200);
});

test("JSON request limit is enforced when Content-Length is absent", async () => {
  const ctx = fixture();
  const body = JSON.stringify({ email: "owner@klirline.ca", password: "x".repeat(2 * 1024 * 1024) });
  const request = new Request("https://api.test/api/auth/register", {
    method: "POST",
    headers: { Origin: "https://app.test", "Content-Type": "application/json", "X-Klirline-Request": "1" },
    body
  });
  assert.equal(request.headers.get("Content-Length"), null);
  const response = await worker.fetch(request, ctx.env, { waitUntil() {} });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, "request-too-large");
});

test("subscription signup stays gated until a verified Stripe subscription is active", async () => {
  const disabled = fixture();
  await bootstrap(disabled);
  assert.equal((await (await disabled.request("/api/public-config")).json()).publicSignupEnabled, false);
  const rejectedSignup = await disabled.request("/api/auth/signup", "POST", { email: "closed@example.ca", password: "a-secure-password-123", organizationName: "Closed Studio" });
  assert.equal(rejectedSignup.status, 503);
  const ctx = fixture({ ALLOW_PUBLIC_SIGNUP: "true", STRIPE_SECRET_KEY: "sk_test_example", STRIPE_PRICE_ID: "price_test_example", STRIPE_WEBHOOK_SECRET: "whsec_example", PLAN_MONTHLY_POST_LIMIT: "1", PLAN_MAX_ACCOUNTS: "1" });
  await bootstrap(ctx);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(init.headers.Authorization, "Bearer sk_test_example");
    if (String(url) === "https://api.stripe.com/v1/checkout/sessions") {
      const form = new URLSearchParams(init.body);
      assert.equal(form.get("mode"), "subscription");
      assert.equal(form.get("line_items[0][price]"), "price_test_example");
      return Response.json({ url: "https://checkout.stripe.com/c/pay/cs_test_example" });
    }
    if (String(url) === "https://api.stripe.com/v1/billing_portal/sessions") return Response.json({ url: "https://billing.stripe.com/p/session/test_example" });
    throw new Error(`Unexpected Stripe API request: ${String(url)}`);
  };
  try {
    const signup = await ctx.request("/api/auth/signup", "POST", { email: "owner@example.ca", password: "a-secure-password-123", organizationName: "Example Studio" });
    assert.equal(signup.status, 201);
    const signedUp = await signup.json();
    assert.equal(signedUp.billing.canPublish, false);
    assert.equal(signedUp.checkoutUrl, "https://checkout.stripe.com/c/pay/cs_test_example");
    const cookie = signup.headers.get("set-cookie").split(";")[0];
    const inactiveSchedule = await ctx.request("/api/scheduled", "POST", { text: "Hello", targets: ["facebook"], runAtUTC: new Date(Date.now() + 120000).toISOString() }, { Cookie: cookie });
    assert.equal(inactiveSchedule.status, 402);

    const nowSeconds = Math.floor(Date.now() / 1000);
    const event = { id: "evt_subscription_created", created: nowSeconds, type: "customer.subscription.created", data: { object: { id: "sub_example", customer: "cus_example", status: "active", metadata: { organization_id: signedUp.user.org }, items: { data: [{ current_period_start: nowSeconds, current_period_end: nowSeconds + 30 * 86400 }] } } } };
    async function sendStripeEvent(value) {
      const raw = JSON.stringify(value); const timestamp = Math.floor(Date.now() / 1000);
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(ctx.env.STRIPE_WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const signatureBytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${raw}`)));
      const signature = [...signatureBytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const request = new Request("https://api.test/api/billing/webhook", { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${timestamp},v1=${signature}` }, body: raw });
      return worker.fetch(request, ctx.env, { waitUntil() {} });
    }
    const invalidWebhook = await worker.fetch(new Request("https://api.test/api/billing/webhook", { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": `t=${Math.floor(Date.now() / 1000)},v1=00` }, body: JSON.stringify(event) }), ctx.env, { waitUntil() {} });
    assert.equal(invalidWebhook.status, 400);
    const oversizedWebhook = await worker.fetch(new Request("https://api.test/api/billing/webhook", { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": "t=1,v1=00" }, body: " ".repeat(1024 * 1024 + 1) }), ctx.env, { waitUntil() {} });
    assert.equal(oversizedWebhook.status, 413);
    const activated = await sendStripeEvent(event);
    assert.equal(activated.status, 200);
    assert.equal((await ctx.request("/api/billing", "GET", null, { Cookie: cookie }).then((res) => res.json())).canPublish, true);
    ctx.sqlite.prepare("UPDATE organizations SET billing_period_end=? WHERE id=?").run(new Date(Date.now() - 1000).toISOString(), signedUp.user.org);
    const expiredBilling = await ctx.request("/api/billing", "GET", null, { Cookie: cookie }).then((res) => res.json());
    assert.equal(expiredBilling.status, "expired");
    assert.equal(expiredBilling.canPublish, false);
    ctx.sqlite.prepare("UPDATE organizations SET billing_period_end=? WHERE id=?").run(new Date(Date.now() + 30 * 86400000).toISOString(), signedUp.user.org);
    const scheduleBody = { text: "Hello", targets: ["facebook"], runAtUTC: new Date(Date.now() + 120000).toISOString() };
    const scheduled = await ctx.request("/api/scheduled", "POST", scheduleBody, { Cookie: cookie, "Idempotency-Key": "schedule-one" });
    assert.equal(scheduled.status, 200);
    const scheduleId = (await scheduled.json()).job.id;
    const scheduleReplay = await ctx.request("/api/scheduled", "POST", scheduleBody, { Cookie: cookie, "Idempotency-Key": "schedule-one" });
    assert.equal((await scheduleReplay.json()).deduped, true);
    const quotaExceeded = await ctx.request("/api/scheduled", "POST", { ...scheduleBody, text: "Second post" }, { Cookie: cookie, "Idempotency-Key": "schedule-two" });
    assert.equal(quotaExceeded.status, 429);
    const canceledSchedule = await ctx.request(`/api/scheduled/${encodeURIComponent(scheduleId)}`, "DELETE", null, { Cookie: cookie });
    assert.equal((await canceledSchedule.json()).status, "canceled");
    const directPost = await ctx.request("/api/publish", "POST", { text: "One direct post", targets: ["facebook"] }, { Cookie: cookie, "Idempotency-Key": "publish-one" });
    assert.equal(directPost.status, 200);
    const directQuotaExceeded = await ctx.request("/api/scheduled", "POST", { ...scheduleBody, text: "Third post" }, { Cookie: cookie, "Idempotency-Key": "schedule-three" });
    assert.equal(directQuotaExceeded.status, 429);
    const usage = await ctx.request("/api/billing", "GET", null, { Cookie: cookie }).then((res) => res.json());
    assert.deepEqual({ publications: usage.usage.publications, limit: usage.usage.publicationLimit }, { publications: 1, limit: 1 });
    const portal = await ctx.request("/api/billing/portal", "POST", {}, { Cookie: cookie });
    assert.equal((await portal.json()).portalUrl, "https://billing.stripe.com/p/session/test_example");
    const activeDelete = await ctx.request("/api/account", "DELETE", { password: "a-secure-password-123" }, { Cookie: cookie });
    assert.equal(activeDelete.status, 409);
    const duplicate = await sendStripeEvent(event);
    assert.deepEqual(await duplicate.json(), { received: true, duplicate: true });
    const canceled = await sendStripeEvent({ ...event, id: "evt_subscription_canceled", type: "customer.subscription.deleted" });
    assert.equal(canceled.status, 200);
    assert.equal((await ctx.request("/api/billing", "GET", null, { Cookie: cookie }).then((res) => res.json())).canPublish, false);
    const staleUpdate = await sendStripeEvent({ ...event, id: "evt_subscription_stale_update", created: nowSeconds - 60, type: "customer.subscription.updated" });
    assert.equal(staleUpdate.status, 200);
    assert.equal((await ctx.request("/api/billing", "GET", null, { Cookie: cookie }).then((res) => res.json())).canPublish, false);
    const deleted = await ctx.request("/api/account", "DELETE", { password: "a-secure-password-123" }, { Cookie: cookie });
    assert.equal(deleted.status, 200);
  } finally { globalThis.fetch = originalFetch; }
});

test("internal workspace publishes without billing and keeps public signup closed", async () => {
  const ctx = fixture({ INTERNAL_MODE: "true", ALLOW_PUBLIC_SIGNUP: "true" });
  await bootstrap(ctx);
  ctx.sqlite.prepare("UPDATE organizations SET billing_status='canceled' WHERE id='klirline'").run();
  const cookie = (await ctx.request("/api/auth/login", "POST", { email: "owner@klirline.ca", password: "a-secure-password-123" })).headers.get("set-cookie").split(";")[0];
  const config = await (await ctx.request("/api/public-config")).json();
  assert.equal(config.internalMode, true);
  assert.equal(config.publicSignupEnabled, false);
  const access = await (await ctx.request("/api/billing", "GET", null, { Cookie: cookie })).json();
  assert.equal(access.status, "internal");
  assert.equal(access.canPublish, true);
  const publish = await ctx.request("/api/publish", "POST", { text: "Klirline interne", targets: ["facebook"] }, { Cookie: cookie });
  assert.equal(publish.status, 200);
  assert.equal((await publish.json()).results[0].status, "action-required");
  const signup = await ctx.request("/api/auth/signup", "POST", { email: "external@example.ca", password: "a-secure-password-123", organizationName: "External" });
  assert.equal(signup.status, 503);
});

test("health endpoint reports missing production bindings and secrets", async () => {
  const healthy = fixture();
  assert.equal((await healthy.request("/api/health")).status, 200);
  const missingR2 = fixture({ MEDIA: null });
  const response = await missingR2.request("/api/health");
  assert.equal(response.status, 503);
  assert.equal((await response.json()).checks.mediaStorage, false);
  const missingKey = fixture({ TOKENS_ENCRYPTION_KEY_HEX: "" });
  assert.equal((await missingKey.request("/api/health")).status, 503);
});

test("LinkedIn OAuth verifies access to the configured organization", async () => {
  const ctx = fixture({ PLAN_MAX_ACCOUNTS: "1" });
  const adminCookie = await bootstrap(ctx);
  const originalFetch = globalThis.fetch;
  let allowAdminRole = true;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("/oauth/v2/accessToken")) return Response.json({ access_token: "test-access-token", expires_in: 3600 });
    if (target.includes("/v2/userinfo")) return Response.json({ sub: "member-1", name: "LinkedIn Member" });
    if (target.includes("/organizationAcls")) return Response.json({ elements: allowAdminRole
      ? [{ state: "APPROVED", role: "ADMINISTRATOR", organization: ctx.env.LINKEDIN_ORGANIZATION_URN }]
      : [{ state: "APPROVED", role: "CONTENT_ADMIN", organization: ctx.env.LINKEDIN_ORGANIZATION_URN }] });
    throw new Error(`Unexpected mocked fetch: ${target}`);
  };
  try {
    async function begin(cookie) {
      const response = await ctx.request("/oauth/linkedin/start", "GET", null, { Cookie: cookie });
      const stateCookie = response.headers.get("set-cookie").split(";")[0];
      const location = response.headers.get("location");
      return { cookie: stateCookie, state: new URL(location).searchParams.get("state"), location };
    }
    const oauth = await begin(adminCookie);
    assert.match(new URL(oauth.location).searchParams.get("scope"), /r_organization_admin/);
    const accepted = await ctx.request(`/oauth/linkedin/callback?code=fake&state=${encodeURIComponent(oauth.state)}`, "GET", null, { Cookie: `${adminCookie}; ${oauth.cookie}` });
    assert.equal(accepted.status, 302);
    const connections = await (await ctx.request("/api/connections", "GET", null, { Cookie: adminCookie })).json();
    assert.ok(connections.some((item) => item.provider === "linkedin" && item.account.label === "LinkedIn organization"));
    const overAccountLimit = await ctx.request("/oauth/instagram/start", "GET", null, { Cookie: adminCookie });
    assert.equal(overAccountLimit.status, 429);

    const forbiddenInvite = await ctx.request("/api/auth/register", "POST", { email: "writer@klirline.ca", password: "another-secure-password" }, { Cookie: adminCookie });
    assert.equal(forbiddenInvite.status, 403);
    const saltBytes = Uint8Array.from({ length: 16 }, (_, i) => i + 1); const salt = base64url(saltBytes);
    const passwordHash = await testPasswordHash("another-secure-password", saltBytes);
    ctx.sqlite.prepare("INSERT INTO users(id,email,password_salt,password_hash,role,org_id,created_at) VALUES(?,?,?,?,?,?,?)").run("writer-id", "writer@klirline.ca", salt, passwordHash, "redacteur", "klirline", new Date().toISOString());
    const login = await ctx.request("/api/auth/login", "POST", { email: "writer@klirline.ca", password: "another-secure-password" });
    const readerCookie = login.headers.get("set-cookie").split(";")[0];
    const deniedOAuth = await begin(readerCookie);
    allowAdminRole = false;
    const denied = await ctx.request(`/oauth/linkedin/callback?code=fake&state=${encodeURIComponent(deniedOAuth.state)}`, "GET", null, { Cookie: `${readerCookie}; ${deniedOAuth.cookie}` });
    assert.equal(denied.status, 403);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("publication adapters send image posts to Instagram, Facebook Page, and LinkedIn", async () => {
  const ctx = fixture({
    META_APP_ID: "meta-client", META_APP_SECRET: "meta-secret",
    INSTAGRAM_REDIRECT_URI: "https://api.test/oauth/instagram/callback",
    FACEBOOK_REDIRECT_URI: "https://api.test/oauth/facebook/callback", FACEBOOK_PAGE_ID: "page-123",
    LINKEDIN_ORGANIZATION_NAME: "Klirline Inc."
  });
  const cookie = await bootstrap(ctx);
  const calls = [];
  let rejectFacebook = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    calls.push({ url: target, method: init.method || "GET", headers: new Headers(init.headers || {}), body: init.body });
    if (target.includes("graph.instagram.com/access_token")) return Response.json({ access_token: "instagram-long-lived-token", expires_in: 5184000, token_type: "bearer" });
    if (target.includes("graph.instagram.com/refresh_access_token")) return Response.json({ access_token: "instagram-refreshed-token", expires_in: 5184000, token_type: "bearer" });
    if (target.includes("/oauth/access_token") || target.includes("/oauth/v2/accessToken")) {
      if (target.includes("linkedin") && String(calls.at(-1)?.body || "").includes("grant_type=refresh_token")) return Response.json({ access_token: "linkedin-refreshed-token", expires_in: 3600, refresh_token: "linkedin-next-refresh-token", refresh_token_expires_in: 86400 });
      const token = target.includes("linkedin") ? "linkedin-user-token" : target.includes("graph.facebook.com") ? "facebook-user-token" : "instagram-short-lived-token";
      return Response.json({ access_token: token, expires_in: 3600, ...(target.includes("linkedin") ? { refresh_token: "linkedin-refresh-token", refresh_token_expires_in: 86400 } : {}) });
    }
    if (target.includes("graph.instagram.com/v26.0/me")) return Response.json({ user_id: "ig-account-1", username: "klirlineofficial" });
    if (target.includes("graph.facebook.com/v26.0/me?")) return Response.json({ id: "fb-user-1", name: "Klirline Admin" });
    if (target.includes("graph.facebook.com/v26.0/me/accounts")) return Response.json({ data: [{ id: "page-123", name: "Klirline Page", access_token: "facebook-page-token", tasks: ["CREATE_CONTENT"] }] });
    if (target.includes("api.linkedin.com/v2/userinfo")) return Response.json({ sub: "li-member-1", name: "Klirline Admin" });
    if (target.includes("organizationAcls")) return Response.json({ elements: [{ state: "APPROVED", role: "ADMINISTRATOR", organization: ctx.env.LINKEDIN_ORGANIZATION_URN }] });
    if (target.includes("graph.instagram.com/v26.0/ig-account-1/media_publish")) return Response.json({ id: "ig-published-1" });
    if (target.includes("graph.instagram.com/v26.0/ig-account-1/media")) return Response.json({ id: "ig-container-1" });
    if (target.includes("graph.facebook.com/v26.0/page-123/photos")) {
      if (rejectFacebook) return Response.json({ error: { message: "Rate limit" } }, { status: 429 });
      return Response.json({ id: "fb-photo-1", post_id: "fb-published-1" });
    }
    if (target.includes("api.linkedin.com/rest/images?action=initializeUpload")) return Response.json({ value: { uploadUrl: "https://upload.linkedin.test/image", image: "urn:li:image:image-1" } });
    if (target === "https://upload.linkedin.test/image") return new Response(null, { status: 201 });
    if (target.includes("api.linkedin.com/rest/images/urn%3Ali%3Aimage%3Aimage-1")) return Response.json({ status: "AVAILABLE" });
    if (target === "https://api.linkedin.com/rest/posts") return new Response("{}", { status: 201, headers: { "x-restli-id": "urn:li:share:linkedin-published-1" } });
    throw new Error(`Unexpected mocked provider request: ${target}`);
  };
  try {
    for (const provider of ["instagram", "facebook", "linkedin"]) {
      const start = await ctx.request(`/oauth/${provider}/start`, "GET", null, { Cookie: cookie });
      assert.equal(start.status, 302);
      const stateCookie = start.headers.get("set-cookie").split(";")[0];
      const state = new URL(start.headers.get("location")).searchParams.get("state");
      const callback = await ctx.request(`/oauth/${provider}/callback?code=fake-${provider}&state=${encodeURIComponent(state)}`, "GET", null, { Cookie: `${cookie}; ${stateCookie}` });
      assert.equal(callback.status, 302);
    }

    ctx.sqlite.prepare("UPDATE connections SET expires_at=? WHERE provider IN ('instagram','linkedin')").run(new Date(Date.now() - 1000).toISOString());

    const form = new FormData();
    form.append("file", new Blob([Uint8Array.from([255, 216, 255, 0])], { type: "image/jpeg" }), "campaign.jpg");
    const uploaded = await (await ctx.request("/api/media", "POST", form, { Cookie: cookie })).json();
    const response = await ctx.request("/api/publish", "POST", {
      text: "Découvrez les services Klirline", targets: ["instagram", "facebook", "linkedin"], mediaId: uploaded.id
    }, { Cookie: cookie, "Idempotency-Key": "three-network-image-post" });
    const publication = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(publication.results.map((item) => item.status), ["published", "published", "published"]);
    assert.deepEqual(publication.results.map((item) => item.postId), ["ig-published-1", "fb-published-1", "urn:li:share:linkedin-published-1"]);
    assert.equal(calls.find((call) => call.url.includes("instagram.com/v26.0/ig-account-1/media_publish")).headers.get("authorization"), "Bearer instagram-refreshed-token");
    assert.ok(calls.some((call) => call.url.includes("graph.instagram.com/access_token") && new URL(call.url).searchParams.get("grant_type") === "ig_exchange_token"));
    assert.ok(calls.some((call) => call.url.includes("graph.instagram.com/refresh_access_token") && new URL(call.url).searchParams.get("grant_type") === "ig_refresh_token"));
    assert.equal(calls.find((call) => call.url.includes("facebook.com/v26.0/page-123/photos")).headers.get("authorization"), "Bearer facebook-page-token");
    assert.equal(calls.find((call) => call.url === "https://api.linkedin.com/rest/posts").headers.get("authorization"), "Bearer linkedin-refreshed-token");
    assert.ok(calls.some((call) => call.url.includes("/oauth/v2/accessToken") && String(call.body).includes("grant_type=refresh_token")));
    assert.equal(calls.find((call) => call.url === "https://api.linkedin.com/rest/posts").headers.get("linkedin-version"), "202610");
    rejectFacebook = true;
    const partial = await ctx.request("/api/publish", "POST", {
      text: "Mise à jour Klirline", targets: ["instagram", "facebook", "linkedin"], mediaId: uploaded.id
    }, { Cookie: cookie, "Idempotency-Key": "partial-three-network-post" });
    const partialResults = (await partial.json()).results;
    assert.deepEqual(partialResults.map((item) => item.status), ["published", "failed", "published"]);
    assert.equal(partialResults[1].retryable, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
