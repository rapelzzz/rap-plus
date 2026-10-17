/**
 * rap-simplify utils — re-exported from the shared git-diff module.
 *
 * The diff/argument parsing is shared with rap-code-review, so it lives in
 * `_shared/git-diff.ts`. These aliases keep rap-simplify's own imports stable.
 */

export {
	parseGitDiff,
	buildDiffArgs,
	formatChangedFiles,
	parseDiffArgs as parseSimplifyArgs,
	type ChangedFile,
	type Hunk,
	type DiffArgs as SimplifyArgs,
} from "../_shared/git-diff.ts";
