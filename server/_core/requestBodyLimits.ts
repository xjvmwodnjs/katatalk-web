import express, { type RequestHandler } from "express";

/** Public JSON APIs do not accept SGF files; upload uses its own Multer cap. */
export const JSON_REQUEST_BODY_LIMIT = "1mb";
/** No current route requires a large HTML form body. */
export const URL_ENCODED_REQUEST_BODY_LIMIT = "32kb";

export function createJsonBodyParser(): RequestHandler {
  return express.json({ limit: JSON_REQUEST_BODY_LIMIT });
}

export function createUrlEncodedBodyParser(): RequestHandler {
  return express.urlencoded({
    limit: URL_ENCODED_REQUEST_BODY_LIMIT,
    extended: false,
  });
}
