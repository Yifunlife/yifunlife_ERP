// Keep Worker runtime declarations scoped so they do not replace browser DOM types.
type D1Database = import("./worker").D1Database;
type R2Bucket = import("./worker").R2Bucket;
type Fetcher = { fetch(request: Request): Promise<Response> };
declare module "cloudflare:workers" {
  export const env: { DB: D1Database; PRODUCT_IMAGES: R2Bucket };
}
