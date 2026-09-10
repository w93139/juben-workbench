/** Whole-source intake limit; the server reads long sources in bounded segments. */
export const ANALYSIS_INPUT_BYTES = 12_000_000;
export const ANALYSIS_DOCUMENT_LIMIT = 2000;
/** Latency-oriented source batches; independent of the hard context ceiling. */
export const ANALYSIS_DIRECT_BYTES = 60000;
export const ANALYSIS_BATCH_BYTES = 30000;
export const ANALYSIS_SEGMENT_BYTES = 20000;
export const ANALYSIS_MAX_BATCHES = 512;
/** Full analysis payload, including escaped author instructions and summaries. */
export const ANALYSIS_CALL_BYTES = 128000;
/** Bound for each model request and non-analysis operations. */
export const SINGLE_CONTEXT_BYTES = 600000;
