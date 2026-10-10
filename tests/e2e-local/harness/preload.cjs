// TEST HARNESS ONLY: route Paystack, Nominatim and the Cloudinary upload API to the local stub.
// Loaded into the app server with NODE_OPTIONS=--require <this file>.
const STUB = process.env.STUB_URL || 'http://localhost:4010';
const orig = globalThis.fetch;
globalThis.fetch = function (input, init) {
  let url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('https://api.paystack.co')) url = STUB + url.slice('https://api.paystack.co'.length);
  else if (url.startsWith('https://nominatim.openstreetmap.org')) url = STUB + url.slice('https://nominatim.openstreetmap.org'.length);
  else if (url.startsWith('https://api.cloudinary.com')) url = STUB + '/cloudinary' + url.slice('https://api.cloudinary.com'.length);
  else return orig(input, init);
  if (typeof input !== 'string' && !(input instanceof URL)) return orig(new Request(url, input), init);
  return orig(url, init);
};
