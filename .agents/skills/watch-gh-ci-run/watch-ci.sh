#!/usr/bin/env bash
# watch-ci.sh — poll a GitHub Actions workflow run and emit one stdout line
# per newly completed job, then a terminal RUN_COMPLETE line.
#
# Designed to be invoked from the Monitor tool so each line becomes a
# task-notification. Self-terminates on workflow completion.
#
# Usage:
#   watch-ci.sh <run-id> <owner/repo> [poll-seconds]
#
# Output format:
#   <job-name>: <conclusion>     # one line per newly completed job
#   RUN_COMPLETE: <conclusion>   # final line when workflow status flips to completed
#
# Exit codes:
#   0  workflow finished with conclusion == success
#   1  workflow finished with any other conclusion (failure/cancelled/timed_out/...)
#   2  usage error

set -uo pipefail

if [ "$#" -lt 2 ]; then
	printf 'usage: %s <run-id> <owner/repo> [poll-seconds]\n' "$0" >&2
	exit 2
fi

run_id="$1"
repo="$2"
poll="${3:-45}"

prev=""
while true; do
	s=$(gh run view "$run_id" --repo "$repo" --json status,conclusion,jobs 2>/dev/null) || s=""

	if [ -n "$s" ]; then
		cur=$(jq -r '.jobs[]? | select(.status=="completed") | "\(.name): \(.conclusion)"' <<<"$s" | sort)
		comm -13 <(printf '%s\n' "$prev") <(printf '%s\n' "$cur")
		prev="$cur"

		run_state=$(jq -r '.status // empty' <<<"$s")

		if [ "$run_state" = "completed" ]; then
			conclusion=$(jq -r '.conclusion // "unknown"' <<<"$s")
			echo "RUN_COMPLETE: $conclusion"
			[ "$conclusion" = "success" ] && exit 0
			exit 1
		fi
	fi

	sleep "$poll"
done
