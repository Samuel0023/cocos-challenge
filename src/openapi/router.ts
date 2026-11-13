import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { parse } from 'yaml';

/** The OpenAPI document, read once next to this module (never from the working directory). */
const openApiYaml = readFileSync(join(import.meta.dirname, 'openapi.yaml'), 'utf8');
const openApiDocument = parse(openApiYaml) as swaggerUi.JsonObject;

/** `GET /openapi.yaml` (the raw document) and `GET /docs/` (Swagger UI for it). */
export function createDocsRouter(): Router {
  const router = Router();
  const page = swaggerUi.setup(openApiDocument);

  router.get('/openapi.yaml', (_req, res) => {
    res.type('application/yaml').send(openApiYaml);
  });

  // Swagger UI assets; anything else under /docs falls through to the JSON 404.
  router.use('/docs', swaggerUi.serveFiles(openApiDocument));
  router.get('/docs', (req, res, next) => {
    // The page loads its assets with relative URLs, so it must be served under /docs/.
    if (!req.originalUrl.split('?')[0]?.endsWith('/')) {
      res.redirect(301, '/docs/');
      return;
    }
    page(req, res, next);
  });

  return router;
}
