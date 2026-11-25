import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from the repository root even if the host launches Node from a different cwd
dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config();

// Production hosting entry point: default NODE_ENV to production unless explicitly set
// so managed Node.js hosts (e.g., Hostinger) serve the compiled dist/ bundle instead of Vite dev middleware.
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "production";
}

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
