import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import worker from "../src/index.js";

function fixture(overrides = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const migration of readdirSync(new URL("../migrations/", import.meta.url)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort()) {
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
    DB, MEDIA, INTERNAL_MODE: "true", SESSION_SECRET: "s".repeat(48), TOKENS_ENCRYPTION_KEY_HEX: "a".repeat(64),
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

test("internal auth, media, scheduling, and publish idempotency", async () => {
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

  const schedule = { text: "Klirline", targets: ["instagram"], mediaId: media.id, runAtUTC: new Date(Date.now() + 120000).toISOString(), timezone: "America/Toronto" };
  const queued = await ctx.request("/api/scheduled", "POST", schedule, { Cookie: cookie, "Idempotency-Key": "schedule-once" });
  const queuedJob = (await queued.json()).job;
  assert.equal(queuedJob.status, "queued");
  assert.equal(queuedJob.timezone,"America/Toronto");
  const invalidZone = await ctx.request("/api/scheduled","POST",{...schedule,timezone:"Mars/Olympus_Mons"},{Cookie:cookie,"Idempotency-Key":"schedule-invalid-zone"});
  assert.equal(invalidZone.status,400);
  assert.equal((await invalidZone.json()).error,"invalid-time-zone");
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
  assert.equal(processedJobs.find((job) => job.id === queuedJob.id).timezone,"America/Toronto");
  const cronAudit = await (await ctx.request("/api/audit", "GET", null, { Cookie: cookie })).json();
  assert.ok(cronAudit.some((event) => event.type === "publication.schedule.processed" && event.targetId === queuedJob.id));

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
  assert.equal(deletion.status, 409);
  assert.equal((await ctx.request("/api/me", "GET", null, { Cookie: cookie })).status, 200);
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

test("internal workspace publishes without billing and keeps public signup closed", async () => {
  const ctx = fixture({ INTERNAL_MODE: "true", ALLOW_PUBLIC_SIGNUP: "true" });
  await bootstrap(ctx);
  ctx.sqlite.prepare("UPDATE organizations SET billing_status='canceled' WHERE id='klirline'").run();
  const cookie = (await ctx.request("/api/auth/login", "POST", { email: "owner@klirline.ca", password: "a-secure-password-123" })).headers.get("set-cookie").split(";")[0];
  const config = await (await ctx.request("/api/public-config")).json();
  assert.equal(config.internalMode, true);
  assert.equal(config.publicSignupEnabled, false);
  const access = await (await ctx.request("/api/usage", "GET", null, { Cookie: cookie })).json();
  assert.equal(access.status, "internal");
  assert.equal(access.usage.publicationLimit, 5000);
  const publish = await ctx.request("/api/publish", "POST", { text: "Klirline interne", targets: ["facebook"] }, { Cookie: cookie });
  assert.equal(publish.status, 200);
  assert.equal((await publish.json()).results[0].status, "action-required");
  const signup = await ctx.request("/api/auth/signup", "POST", { email: "external@example.ca", password: "a-secure-password-123", organizationName: "External" });
  assert.equal(signup.status, 404);
});

test("shared campaign drafts enforce workspace visibility and approval roles", async () => {
  const ctx=fixture(); const adminCookie=await bootstrap(ctx);
  const invite=await ctx.request("/api/team/invitations","POST",{email:"editor-drafts@klirline.ca",role:"redacteur"},{Cookie:adminCookie});
  const token=new URL((await invite.json()).invitationUrl).searchParams.get("invite");
  const accepted=await ctx.request("/api/team/accept","POST",{token,password:"draft-editor-password-123"});
  const editorCookie=accepted.headers.get("set-cookie").split(";")[0];
  const imageForm=new FormData(); imageForm.append("file",new Blob([Uint8Array.from([255,216,255,0])],{type:"image/jpeg"}),"canada.jpg");
  const mediaUpload=await ctx.request("/api/media","POST",imageForm,{Cookie:adminCookie}); const mediaId=(await mediaUpload.json()).id;
  const draftResponse=await ctx.request("/api/drafts","POST",{title:"Campagne Canada",text:"Version française de campagne",targets:["facebook"],countryCode:"ca",languageTag:"fr-CA",timezone:"America/Toronto",mediaId},{Cookie:editorCookie});
  assert.equal(draftResponse.status,201);
  const draft=await draftResponse.json();
  assert.equal(draft.countryCode,"CA"); assert.equal(draft.reviewStatus,"draft"); assert.equal(draft.mediaId,mediaId);
  assert.equal((await (await ctx.request("/api/drafts","GET",null,{Cookie:adminCookie})).json())[0].id,draft.id);
  assert.equal((await ctx.request(`/api/drafts/${draft.id}/review`,"POST",{decision:"approved"},{Cookie:editorCookie})).status,403);
  assert.equal((await ctx.request(`/api/drafts/${draft.id}`,"POST",{action:"submit-review"},{Cookie:editorCookie})).status,200);
  assert.equal((await ctx.request(`/api/drafts/${draft.id}/review`,"POST",{decision:"rejected",note:"Préciser l’offre"},{Cookie:adminCookie})).status,200);
  const corrected=await ctx.request(`/api/drafts/${draft.id}`,"PUT",{title:"Campagne Canada corrigée",text:"Version corrigée",targets:["facebook"],countryCode:"CA",languageTag:"fr-CA",timezone:"America/Toronto"},{Cookie:editorCookie});
  assert.equal((await corrected.json()).reviewStatus,"draft");
  assert.equal((await ctx.request("/api/drafts","POST",{text:"Mauvais pays",countryCode:"CAN"},{Cookie:editorCookie})).status,400);
  assert.equal((await ctx.request("/api/drafts","GET")).status,401);
  const audit=await (await ctx.request("/api/audit","GET",null,{Cookie:adminCookie})).json();
  assert.ok(audit.some(event=>event.type==="campaign.draft.rejected"));
});

test("internal team invitations create shared workspace readers and allow access revocation", async () => {
  const ctx = fixture({ INTERNAL_MODE: "true" });
  const adminCookie = await bootstrap(ctx);
  const invite = await ctx.request("/api/team/invitations", "POST", { email: "editor@klirline.ca", role: "redacteur" }, { Cookie: adminCookie });
  assert.equal(invite.status, 201);
  const inviteData = await invite.json();
  const token = new URL(inviteData.invitationUrl).searchParams.get("invite");
  assert.ok(token);
  assert.equal((await (await ctx.request("/api/team/invitations","GET",null,{Cookie:adminCookie})).json()).length,1);
  const accepted = await ctx.request("/api/team/accept", "POST", { token, password: "editor-secure-password-123" });
  assert.equal(accepted.status, 201);
  const editorCookie = accepted.headers.get("set-cookie").split(";")[0];
  assert.equal((await ctx.request("/api/team/accept", "POST", { token, password: "editor-secure-password-123" })).status, 400);
  const earlyAudit = await (await ctx.request("/api/audit", "GET", null, { Cookie: adminCookie })).json();
  assert.deepEqual(earlyAudit.map((event) => event.type), ["team.invitation.accepted","team.invitation.created"]);
  assert.equal(earlyAudit[0].actorEmail,"editor@klirline.ca");

  const adminId = ctx.sqlite.prepare("SELECT id FROM users WHERE email='owner@klirline.ca'").get().id;
  const editorId = ctx.sqlite.prepare("SELECT id FROM users WHERE email='editor@klirline.ca'").get().id;
  ctx.sqlite.prepare("INSERT INTO posts(id,user_id,text,results_json,created_at) VALUES('shared-post',?,'Internal campaign','[]',?)").run(adminId,new Date().toISOString());
  const sharedPosts = await (await ctx.request("/api/posts", "GET", null, { Cookie: editorCookie })).json();
  assert.equal(sharedPosts.length, 1);
  assert.equal(sharedPosts[0].authorId, adminId);
  const imageForm = new FormData();
  imageForm.append("file",new Blob([Uint8Array.from([255,216,255,0])],{type:"image/jpeg"}),"team.jpg");
  const uploaded = await ctx.request("/api/media","POST",imageForm,{Cookie:adminCookie});
  const sharedMedia = await uploaded.json();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const rawKey = Uint8Array.from(ctx.env.TOKENS_ENCRYPTION_KEY_HEX.match(/.{2}/g),(byte)=>parseInt(byte,16));
  const key = await crypto.subtle.importKey("raw",rawKey,"AES-GCM",false,["encrypt"]);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(JSON.stringify({accessToken:"shared-facebook-token"}))));
  ctx.sqlite.prepare("INSERT INTO connections(id,user_id,provider,account_id,account_label,account_json,scopes_json,token_ciphertext,token_iv,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run("shared-facebook-connection",adminId,"facebook","page-123","Klirline Page",JSON.stringify({id:"page-123",label:"Klirline Page"}),"[]",base64url(sealed),base64url(iv),new Date().toISOString());
  const sharedConnections = await (await ctx.request("/api/connections","GET",null,{Cookie:editorCookie})).json();
  assert.equal(sharedConnections[0].account.label,"Klirline Page");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({id:"shared-page-post"});
  try {
    const published = await ctx.request("/api/publish","POST",{text:"Shared internal campaign",targets:["facebook"],mediaId:sharedMedia.id},{Cookie:editorCookie});
    assert.equal(published.status,200);
    assert.equal((await published.json()).results[0].status,"published");
  } finally { globalThis.fetch = originalFetch; }
  const scheduled = await ctx.request("/api/scheduled","POST",{text:"Shared scheduled campaign",targets:["facebook"],runAtUTC:new Date(Date.now()+120000).toISOString()},{Cookie:adminCookie});
  assert.equal(scheduled.status,200);
  const scheduleId = (await scheduled.json()).job.id;
  const sharedSchedule = await (await ctx.request("/api/scheduled","GET",null,{Cookie:editorCookie})).json();
  assert.ok(sharedSchedule.some(job=>job.id===scheduleId));
  assert.equal((await ctx.request(`/api/scheduled/${encodeURIComponent(scheduleId)}`,"DELETE",null,{Cookie:editorCookie})).status,200);
  const members = await (await ctx.request("/api/team", "GET", null, { Cookie: adminCookie })).json();
  assert.equal(members.length, 2);
  assert.equal((await ctx.request("/api/team", "GET", null, { Cookie: editorCookie })).status, 403);

  assert.equal((await ctx.request(`/api/team/${encodeURIComponent(editorId)}`, "DELETE", null, { Cookie: adminCookie })).status, 200);
  assert.equal((await ctx.request("/api/posts", "GET", null, { Cookie: editorCookie })).status, 401);
  assert.equal(ctx.sqlite.prepare("SELECT COUNT(*) AS count FROM posts WHERE id='shared-post'").get().count, 1);
  assert.equal((await ctx.request(`/api/team/${encodeURIComponent(editorId)}/activate`,"POST",{}, {Cookie:adminCookie})).status,200);
  const editorLogin = await ctx.request("/api/auth/login","POST",{email:"editor@klirline.ca",password:"editor-secure-password-123"});
  assert.equal(editorLogin.status,200);
  const currentEditorCookie = editorLogin.headers.get("set-cookie").split(";")[0];
  const finalAudit = await (await ctx.request("/api/audit", "GET", null, { Cookie: adminCookie })).json();
  for (const type of ["publication.sent","publication.scheduled","publication.schedule-canceled","team.member.disabled","team.member.enabled"]) assert.ok(finalAudit.some((event) => event.type === type),type);
  assert.equal((await ctx.request("/api/audit", "GET", null, { Cookie: currentEditorCookie })).status,403);
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
  const publicMode = fixture({ INTERNAL_MODE: "false" });
  const publicModeHealth = await publicMode.request("/api/health");
  assert.equal(publicModeHealth.status, 503);
  assert.equal((await publicModeHealth.json()).checks.internalMode,false);
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
    const deniedOAuth = await ctx.request("/oauth/linkedin/start", "GET", null, { Cookie: readerCookie });
    assert.equal(deniedOAuth.status, 403);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("publication adapters send image posts to Instagram, Facebook Page, LinkedIn, and Threads", async () => {
  const ctx = fixture({
    META_APP_ID: "meta-client", META_APP_SECRET: "meta-secret",
    INSTAGRAM_REDIRECT_URI: "https://api.test/oauth/instagram/callback",
    FACEBOOK_REDIRECT_URI: "https://api.test/oauth/facebook/callback", FACEBOOK_PAGE_ID: "page-123",
    LINKEDIN_ORGANIZATION_NAME: "Klirline Inc.", THREADS_APP_ID:"threads-client",THREADS_APP_SECRET:"threads-secret",THREADS_REDIRECT_URI:"https://api.test/oauth/threads/callback",PLAN_MAX_ACCOUNTS:9
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
    if (target.includes("graph.threads.net/access_token")) return Response.json({access_token:"threads-long-lived-token",expires_in:5184000,token_type:"bearer"});
    if (target.includes("graph.threads.net/refresh_access_token")) return Response.json({access_token:"threads-refreshed-token",expires_in:5184000,token_type:"bearer"});
    if (target.includes("/oauth/access_token") || target.includes("/oauth/v2/accessToken")) {
      if (target.includes("linkedin") && String(calls.at(-1)?.body || "").includes("grant_type=refresh_token")) return Response.json({ access_token: "linkedin-refreshed-token", expires_in: 3600, refresh_token: "linkedin-next-refresh-token", refresh_token_expires_in: 86400 });
      const token = target.includes("linkedin") ? "linkedin-user-token" : target.includes("graph.facebook.com") ? "facebook-user-token" : target.includes("graph.threads.net") ? "threads-short-lived-token" : "instagram-short-lived-token";
      return Response.json({ access_token: token, expires_in: 3600, ...(target.includes("linkedin") ? { refresh_token: "linkedin-refresh-token", refresh_token_expires_in: 86400 } : {}) });
    }
    if (target.includes("graph.instagram.com/v26.0/me")) return Response.json({ user_id: "ig-account-1", username: "klirlineofficial" });
    if (target.includes("graph.facebook.com/v26.0/me?")) return Response.json({ id: "fb-user-1", name: "Klirline Admin" });
    if (target.includes("graph.facebook.com/v26.0/me/accounts")) return Response.json({ data: [{ id: "page-123", name: "Klirline Page", access_token: "facebook-page-token", tasks: ["CREATE_CONTENT"] }] });
    if (target.includes("api.linkedin.com/v2/userinfo")) return Response.json({ sub: "li-member-1", name: "Klirline Admin" });
    if (target.includes("graph.threads.net/v1.0/me?fields=id,username")) return Response.json({id:"threads-account-1",username:"klirlineofficial"});
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
    if (target.includes("graph.threads.net/v1.0/threads-account-1/threads_publish")) return Response.json({id:"threads-published-1"});
    if (target.includes("graph.threads.net/v1.0/threads-account-1/threads")) return Response.json({id:"threads-container-1"});
    throw new Error(`Unexpected mocked provider request: ${target}`);
  };
  try {
    let threadsAuthorization;
    for (const provider of ["instagram", "facebook", "linkedin", "threads"]) {
      const start = await ctx.request(`/oauth/${provider}/start`, "GET", null, { Cookie: cookie });
      assert.equal(start.status, 302);
      if(provider==="threads") threadsAuthorization=new URL(start.headers.get("location"));
      const stateCookie = start.headers.get("set-cookie").split(";")[0];
      const state = new URL(start.headers.get("location")).searchParams.get("state");
      const callback = await ctx.request(`/oauth/${provider}/callback?code=fake-${provider}&state=${encodeURIComponent(state)}`, "GET", null, { Cookie: `${cookie}; ${stateCookie}` });
      assert.equal(callback.status, 302);
    }

    ctx.sqlite.prepare("UPDATE connections SET expires_at=? WHERE provider IN ('instagram','linkedin','threads')").run(new Date(Date.now() - 1000).toISOString());

    const form = new FormData();
    form.append("file", new Blob([Uint8Array.from([255, 216, 255, 0])], { type: "image/jpeg" }), "campaign.jpg");
    const uploaded = await (await ctx.request("/api/media", "POST", form, { Cookie: cookie })).json();
    const response = await ctx.request("/api/publish", "POST", {
      text: "Découvrez les services Klirline", targets: ["instagram", "facebook", "linkedin", "threads"], mediaId: uploaded.id
    }, { Cookie: cookie, "Idempotency-Key": "four-network-image-post" });
    const publication = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(publication.results.map((item) => item.status), ["published", "published", "published", "published"]);
    assert.deepEqual(publication.results.map((item) => item.postId), ["ig-published-1", "fb-published-1", "urn:li:share:linkedin-published-1","threads-published-1"]);
    assert.equal(calls.find((call) => call.url.includes("instagram.com/v26.0/ig-account-1/media_publish")).headers.get("authorization"), "Bearer instagram-refreshed-token");
    assert.ok(calls.some((call) => call.url.includes("graph.instagram.com/access_token") && new URL(call.url).searchParams.get("grant_type") === "ig_exchange_token"));
    assert.ok(calls.some((call) => call.url.includes("graph.instagram.com/refresh_access_token") && new URL(call.url).searchParams.get("grant_type") === "ig_refresh_token"));
    assert.equal(calls.find((call) => call.url.includes("facebook.com/v26.0/page-123/photos")).headers.get("authorization"), "Bearer facebook-page-token");
    assert.equal(calls.find((call) => call.url === "https://api.linkedin.com/rest/posts").headers.get("authorization"), "Bearer linkedin-refreshed-token");
    assert.ok(calls.some((call) => call.url.includes("/oauth/v2/accessToken") && String(call.body).includes("grant_type=refresh_token")));
    assert.equal(calls.find((call) => call.url === "https://api.linkedin.com/rest/posts").headers.get("linkedin-version"), "202610");
    assert.equal(calls.find((call) => call.url.includes("threads_publish")).headers.get("authorization"),"Bearer threads-refreshed-token");
    assert.equal(threadsAuthorization.searchParams.get("scope"),"threads_basic,threads_content_publish");
    assert.ok(calls.some((call)=>call.url.includes("graph.threads.net/access_token")&&new URL(call.url).searchParams.get("grant_type")==="th_exchange_token"));
    assert.ok(calls.some((call)=>call.url.includes("graph.threads.net/refresh_access_token")&&new URL(call.url).searchParams.get("grant_type")==="th_refresh_token"));
    const textOnly=await ctx.request("/api/publish","POST",{text:"Campagne Threads sans image",targets:["threads"]},{Cookie:cookie,"Idempotency-Key":"threads-text-only-post"});
    assert.equal(textOnly.status,200);
    assert.equal((await textOnly.json()).results[0].postId,"threads-container-1");
    assert.equal(calls.filter(call=>call.url.includes("threads_publish")).length,1,"text posts are auto-published by the Threads text container");
    rejectFacebook = true;
    const partial = await ctx.request("/api/publish", "POST", {
      text: "Mise à jour Klirline", targets: ["instagram", "facebook", "linkedin", "threads"], mediaId: uploaded.id
    }, { Cookie: cookie, "Idempotency-Key": "partial-three-network-post" });
    const partialResults = (await partial.json()).results;
    assert.deepEqual(partialResults.map((item) => item.status), ["published", "failed", "published", "published"]);
    assert.equal(partialResults[1].retryable, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
