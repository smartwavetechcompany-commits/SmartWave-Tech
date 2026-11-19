import "dotenv/config";

// Root deployment entry point for Node.js 22 Express hosting.
// Reuses the existing Express + Vite application in ./server.ts without duplicating server logic.
async function start() {
  try {
    await import("./server.ts");
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err.code === "ERR_UNKNOWN_FILE_EXTENSION" ||
        err.code === "ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING")
    ) {
      const { register } = await import("tsx/esm/api");
      register();
      await import("./server.ts");
      return;
    }
    throw err;
  }
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
