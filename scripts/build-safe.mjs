import path from "path";
import { fileURLToPath } from "url";

// Cap Go (esbuild), Rust (Tailwind v4 Oxide / LightningCSS), libvips, and libuv worker pools
// BEFORE loading Vite so shared Node.js hosts with strict cgroup/LVE thread or NPROC limits
// (e.g., Hostinger) never crash with Go `runtime.gopark` / `runtime.semacquire1` or EAGAIN.
if (!process.env.GOMAXPROCS) process.env.GOMAXPROCS = "1";
if (!process.env.GOMEMLIMIT) process.env.GOMEMLIMIT = "256MiB";
if (!process.env.GOGC) process.env.GOGC = "50";
if (!process.env.RAYON_NUM_THREADS) process.env.RAYON_NUM_THREADS = "1";
if (!process.env.TOKIO_WORKER_THREADS) process.env.TOKIO_WORKER_THREADS = "1";
if (!process.env.UV_THREADPOOL_SIZE) process.env.UV_THREADPOOL_SIZE = "2";
if (!process.env.VIPS_CONCURRENCY) process.env.VIPS_CONCURRENCY = "1";
if (!process.env.NODE_ENV) process.env.NODE_ENV = "production";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const { build } = await import("vite");

await build({
  root: projectRoot,
  mode: "production",
  logLevel: process.argv.includes("--verbose") ? "info" : "warn",
});
