// server/index.ts
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

// server/routes/health.ts
import { Router } from "express";

// src/config/app.ts
var APP_NAME = "AdLens";
var APP_VERSION = "1.0 (Sprint 1)";
var STORAGE_PREFIX = "adlens_";
var THEME_STORAGE_KEY = `${STORAGE_PREFIX}theme`;
var CURRENCY_STORAGE_KEY = `${STORAGE_PREFIX}currency`;
var TIMEZONE_STORAGE_KEY = `${STORAGE_PREFIX}timezone`;
var DATE_PRESET_STORAGE_KEY = `${STORAGE_PREFIX}date_preset`;
var COMPARE_STORAGE_KEY = `${STORAGE_PREFIX}compare`;

// server/routes/health.ts
var healthRouter = Router();
healthRouter.get("/", (_req, res) => {
  res.json({
    ok: true,
    app: APP_NAME,
    version: APP_VERSION,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
});

// server/index.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var app = express();
app.use(express.json());
app.use("/api/health", healthRouter);
var isProduction = process.env.NODE_ENV === "production" || !process.env.API_PORT;
var distPath = path.resolve(__dirname, "../dist");
if (isProduction) {
  app.use(express.static(distPath));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) {
      next();
      return;
    }
    res.sendFile(path.join(distPath, "index.html"));
  });
}
var port = Number(process.env.API_PORT || process.env.PORT || 3e3);
var server = app.listen(port, "0.0.0.0", () => {
  console.log(`Server listening on http://0.0.0.0:${port}`);
});
server.on("error", (err) => {
  if (err.code === "EADDRINUSE" && process.env.API_PORT) {
    console.log(`API server port ${port} already active, reusing existing listener.`);
    process.exit(0);
  } else {
    console.error("Server error:", err);
    process.exit(1);
  }
});
export {
  app
};
