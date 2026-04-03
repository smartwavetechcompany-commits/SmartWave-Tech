import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    
    // SPA fallback for development
    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      
      // Skip if it's an API request or a file request that should have been handled
      // We check for common file extensions to avoid intercepting assets
      const isAsset = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|json|map)$/.test(url);
      const acceptsHtml = req.headers.accept?.includes('text/html');

      if (url.startsWith('/api') || (isAsset && !acceptsHtml)) {
        return next();
      }

      try {
        // Read index.html from the root
        let template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        
        // Apply Vite HTML transforms
        template = await vite.transformIndexHtml(url, template);
        
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    // Serve static files from dist in production
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    
    // SPA fallback: serve index.html for all unknown routes
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
