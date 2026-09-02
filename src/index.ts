import express from "express";

const app = express();
const port = process.env.PORT ?? 3002;

// Walking skeleton: health check only, no log API yet (TIE-14)
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(port, () => {
  console.log(`log-service listening on port ${port}`);
});
