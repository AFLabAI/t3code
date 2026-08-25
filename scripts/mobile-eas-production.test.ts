// @effect-diagnostics nodeBuiltinImport:off - Execute the committed workflow shell against mocked CLIs.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";

import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { parse } from "yaml";

const Workflow = Schema.Struct({
  on: Schema.Struct({
    schedule: Schema.optional(Schema.Array(Schema.Struct({ cron: Schema.String }))),
  }),
  jobs: Schema.Struct({
    production: Schema.Struct({
      steps: Schema.Array(
        Schema.Struct({
          name: Schema.optional(Schema.String),
          if: Schema.optional(Schema.String),
          run: Schema.optional(Schema.String),
        }),
      ),
    }),
  }),
});

const workflowSource = NodeFS.readFileSync(
  new URL("../.github/workflows/mobile-eas-production.yml", import.meta.url),
  "utf8",
);
const parsedWorkflow: unknown = parse(workflowSource);
const workflow = Schema.decodeUnknownSync(Workflow)(parsedWorkflow);
const latestCommit = "123456789abcdef123456789abcdef123456789ab";

function workflowStep(name: string) {
  const step = workflow.jobs.production.steps.find((candidate) => candidate.name === name);
  if (!step?.run) {
    throw new Error(`Expected a runnable workflow step named '${name}'.`);
  }
  return { ...step, run: step.run };
}

function runPublishStep(options: {
  readonly finishedPlatforms: ReadonlyArray<"ios" | "android">;
  readonly publishedCommit?: string;
  readonly mobileFilesChanged?: boolean;
}) {
  const step = workflowStep("Publish fingerprint-gated OTA");
  const fixture = `
    export GITHUB_EVENT_NAME=schedule
    export GITHUB_STEP_SUMMARY=/dev/null
    MOCK_FINISHED_PLATFORMS='${options.finishedPlatforms.join(" ")}'
    MOCK_PUBLISHED_COMMIT='${options.publishedCommit ?? ""}'
    MOCK_MOBILE_FILES_CHANGED='${options.mobileFilesChanged ? "true" : "false"}'

    eas() {
      local command="$1"
      shift
      local platform=""
      local previous=""
      for argument in "$@"; do
        if [ "$previous" = "--platform" ]; then
          platform="$argument"
        fi
        previous="$argument"
      done

      case "$command" in
        fingerprint:generate)
          printf '{"hash":"native-%s"}\\n' "$platform"
          ;;
        build:list)
          if [[ " $MOCK_FINISHED_PLATFORMS " == *" $platform "* ]]; then
            printf '[{"id":"finished-build"}]\\n'
          else
            printf '[]\\n'
          fi
          ;;
        update:list)
          if [ -n "$MOCK_PUBLISHED_COMMIT" ]; then
            printf '{"currentPage":[{"group":"published-group"}]}\\n'
          else
            printf '{"currentPage":[]}\\n'
          fi
          ;;
        update:view)
          printf '[{"platform":"ios","gitCommitHash":"%s"},{"platform":"android","gitCommitHash":"%s"}]\\n' \\
            "$MOCK_PUBLISHED_COMMIT" "$MOCK_PUBLISHED_COMMIT"
          ;;
        update)
          printf 'published:%s\\n' "$platform"
          ;;
        *)
          printf 'Unexpected EAS command: %s\\n' "$command" >&2
          return 1
          ;;
      esac
    }

    git() {
      case "$1" in
        log)
          printf 'Latest mobile change\\n'
          ;;
        rev-parse)
          if [ "$2" = "--short=9" ]; then
            printf '123456789\\n'
          elif [ "$2" = "--show-toplevel" ]; then
            printf '/mock-repository\\n'
          else
            printf '${latestCommit}\\n'
          fi
          ;;
        cat-file)
          return 0
          ;;
        -C)
          if [ "$MOCK_MOBILE_FILES_CHANGED" = "true" ]; then
            return 1
          fi
          return 0
          ;;
        *)
          printf 'Unexpected Git command: %s\\n' "$1" >&2
          return 1
          ;;
      esac
    }
  `;

  const result = NodeChildProcess.spawnSync("bash", ["-e", "-c", `${fixture}\n${step.run}`], {
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

describe("mobile EAS production workflow", () => {
  it("retries finished native builds on a schedule without scheduling store builds", () => {
    expect(workflow.on.schedule).toEqual([{ cron: "17,47 * * * *" }]);
    expect(workflowStep("Publish fingerprint-gated OTA").if).toContain(
      "github.event_name == 'schedule'",
    );
    expect(workflowStep("Ensure store builds exist for the current app version").if).toContain(
      "github.event_name == 'push'",
    );
  });

  it("publishes the latest compatible update after its native build finishes", () => {
    expect(runPublishStep({ finishedPlatforms: ["ios"] })).toContain("published:ios");
    expect(runPublishStep({ finishedPlatforms: ["android"] })).toContain("published:android");
  });

  it("does not republish updates when the mobile files already match production", () => {
    expect(
      runPublishStep({
        finishedPlatforms: ["ios", "android"],
        publishedCommit: "abcdef123456789abcdef123456789abcdef1234",
      }),
    ).not.toContain("published:");
  });

  it("publishes again when newer commits change mobile files", () => {
    expect(
      runPublishStep({
        finishedPlatforms: ["ios"],
        publishedCommit: "abcdef123456789abcdef123456789abcdef1234",
        mobileFilesChanged: true,
      }),
    ).toContain("published:ios");
  });
});
