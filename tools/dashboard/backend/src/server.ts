import cors from "cors";
import express from "express";
import apiRouter from "./routes/api.js";
import taxRouter from "./routes/tax.js";

const app = express();
const host = process.env.DASHBOARD_API_HOST ?? "127.0.0.1";
const port = Number(process.env.DASHBOARD_API_PORT ?? 8787);
const allowedOrigin = process.env.DASHBOARD_ALLOWED_ORIGIN ?? "http://localhost:5173";

app.use(
  cors({
    origin: allowedOrigin,
  }),
);
app.use(express.json());

app.use("/api", apiRouter);
app.use("/api/tax", taxRouter);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "Unbekannter Fehler";
  res.status(500).json({
    error: {
      code: "internal_error",
      message,
    },
  });
});

app.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`Dashboard API läuft auf http://${host}:${port}`);
});
