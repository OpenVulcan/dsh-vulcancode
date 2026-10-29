/**
 * Bounds of the `ui-*` answer components. The prompt states them to the model and the parser enforces
 * them, so both read these constants. The values follow VulcanCode's
 * `crates/vulcan-session-core/src/v1/answer_components.rs`.
 */

/** Most data rows one component (or one tabs/columns fence) may hold. */
export const ANSWER_COMPONENT_MAX_ROWS = 128

/** Most series one `ui-chart` may draw. */
export const ANSWER_CHART_MAX_SERIES = 8
