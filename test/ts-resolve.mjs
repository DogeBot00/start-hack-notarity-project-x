// Minimal resolver hook so the Node-native test runner can follow the app's
// extensionless TypeScript imports (e.g. './conditions' -> './conditions.ts').
// Only used by `npm run test:engine`; the Next.js bundler handles this itself.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && context.parentURL) {
      const base = new URL(specifier, context.parentURL);
      for (const ext of ['.ts', '.tsx', '/index.ts']) {
        const candidate = new URL(base.href + ext);
        if (existsSync(fileURLToPath(candidate))) {
          return next(specifier + ext, context);
        }
      }
    }
    throw err;
  }
}
