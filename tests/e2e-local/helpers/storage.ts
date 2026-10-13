/**
 * LOCAL STACK ONLY: the browser side of the fake Cloudinary. Uploads the app
 * sends straight from the browser to api.cloudinary.com go to the harness
 * stub instead (the server side is rerouted by harness/preload.cjs), and
 * res.cloudinary.com images are answered with a 1x1 pixel.
 */
import type { BrowserContext } from '@playwright/test';
import { STUB } from './env';

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** A tiny but valid JPEG-named image for file inputs. */
export const PHOTO = { name: 'gear.png', mimeType: 'image/png', buffer: PIXEL };

export async function routeCloudinaryToStub(context: BrowserContext): Promise<void> {
  await context.route('https://api.cloudinary.com/**', async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `${STUB}/cloudinary${url.pathname}` });
    await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
  });
  await context.route('https://res.cloudinary.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }),
  );
}
