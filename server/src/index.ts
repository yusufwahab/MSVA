import { buildContext, createApp } from "./app.js";
import { loadConfig } from "./lib/config.js";
import { syncEnvAdmin } from "./services/admin.js";
import { processDueJobs } from "./services/jobs.js";

const config = loadConfig();
const ctx = buildContext(config);
const app = createApp(ctx);

const synced = await syncEnvAdmin(ctx.db, config);
if (synced !== "unchanged") console.log(`Admin account from ADMIN_EMAIL: ${synced}`);

app.listen(config.PORT, () => {
  console.log(`MSVA API listening on :${config.PORT} (quiz=${ctx.quiz.mode}, email=${config.EMAIL_ADAPTER}, sheets=${config.SHEETS_ADAPTER})`);
});

if (config.RUN_JOBS && ctx.sheets) {
  setInterval(() => {
    processDueJobs(ctx).catch((e) => console.error("job run failed", e));
  }, 30_000).unref();
}
