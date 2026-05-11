/** Maximum SGF upload size for /api/analyze (must match server multer limit). */
export const MAX_SGF_FILE_BYTES = 1024 * 1024;

/** multipart/form-data field name for the SGF file (client + server). */
export const SGF_UPLOAD_FORM_FIELD = "sgf";

export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';
