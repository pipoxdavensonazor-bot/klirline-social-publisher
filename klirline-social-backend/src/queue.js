// File serveur UTC, idempotente, avec annulation et retries prudents.
// Meme cle d idempotence -> meme job (pas de double post). Planification en UTC ISO.
import { saveDb, uid } from "./lib.js";
import { publishOne } from "./publish.js";

const MAX_ATTEMPTS = 5;

export function enqueue(env, db, { authorId, text, targets, mediaId, runAtUTC, idem }) {
  const dup = db.jobs.find((j) => j.idem === idem && j.status !== "canceled");
  if (dup) return { job: dup, deduped: true };
  const job = { id: uid(), idem, authorId, text, targets, mediaId: mediaId || null, runAtUTC, status: "queued", attempts: 0, results: null, createdAt: new Date().toISOString() };
  db.jobs.push(job); saveDb(env, db);
  return { job, deduped: false };
}

export function cancelJob(env, db, id, userId) {
  const j = db.jobs.find((x) => x.id === id && x.authorId === userId);
  if (!j) return null;
  if (j.status !== "queued") return j;
  j.status = "canceled"; saveDb(env, db);
  return j;
}

// Boucle toutes les 15 s : execute les jobs dus, tente chaque destination independamment.
export function startWorker(env, db, getMedia) {
  let active = false;
  // Reprend au démarrage les jobs interrompus; une requête fournisseur peut avoir
  // réussi juste avant l'arrêt, donc la reprise reste au mieux at-least-once.
  for (const job of db.jobs) {
    if (job.status === "processing") {
      job.status = "queued";
      job.runAtUTC = new Date().toISOString();
      saveDb(env, db);
    }
  }
  setInterval(async () => {
    if (active) return;
    active = true;
    try {
    const now = new Date().toISOString();
    const due = db.jobs.filter((j) => j.status === "queued" && j.runAtUTC <= now);
    for (const job of due) {
      job.targetStates ||= Object.fromEntries(job.targets.map((provider) => [provider, { status: "queued", attempts: 0, nextRunAt: job.runAtUTC, result: null }]));
      job.status = "processing";
      saveDb(env, db);
      for (const provider of job.targets) {
        const target = job.targetStates[provider];
        if (!target || target.status === "published" || target.status === "action-required" || target.attempts >= MAX_ATTEMPTS || target.nextRunAt > new Date().toISOString()) continue;
        const conn = db.connections.find((c) => c.userId === job.authorId && c.provider === provider);
        if (!conn) { target.status = "action-required"; target.result = { provider, status: "action-required", message: "not-connected" }; continue; }
        const media = job.mediaId ? getMedia(job.mediaId) : null;
        target.attempts += 1;
        const result = { provider, ...(await publishOne(env, db, { connection: conn, text: job.text, media })) };
        target.result = result;
        target.status = result.status;
        if (result.status === "failed" && target.attempts < MAX_ATTEMPTS) {
          const backoff = [2, 10, 30, 120][Math.min(target.attempts - 1, 3)] * 60 * 1000;
          target.status = "queued";
          target.nextRunAt = new Date(Date.now() + backoff).toISOString();
        }
        saveDb(env, db);
      }
      job.results = job.targets.map((provider) => job.targetStates[provider]?.result).filter(Boolean);
      const states = Object.values(job.targetStates);
      job.status = states.some((s) => s.status === "queued") ? "queued" : states.some((s) => s.status === "failed") ? "failed" : states.some((s) => s.status === "action-required") ? "action-required" : "published";
      const next = states.filter((s) => s.status === "queued").map((s) => s.nextRunAt).sort()[0];
      if (next) job.runAtUTC = next;
      saveDb(env, db);
    }
    } finally { active = false; }
  }, 15000).unref();
}
