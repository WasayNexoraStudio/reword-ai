if (!process.env.VERCEL) {
  await import("./scripts/dev.js");
}
