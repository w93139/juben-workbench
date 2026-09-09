/** Whole-source intake limit; the server reads long sources in bounded segments. */
export const ANALYSIS_INPUT_BYTES = 12_000_000;
export const ANALYSIS_DOCUMENT_LIMIT = 2000;
/** Bound for each model request and non-analysis operations. */
export const SINGLE_CONTEXT_BYTES = 600000;
