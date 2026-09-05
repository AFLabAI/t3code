import * as Schema from "effect/Schema";
declare const CatalogDependencyResolutionError_base: Schema.Class<
  CatalogDependencyResolutionError,
  Schema.TaggedStruct<
    "CatalogDependencyResolutionError",
    {
      readonly workspacePackage: Schema.String;
      readonly dependencyName: Schema.String;
      readonly catalogSpec: Schema.String;
      readonly catalogKey: Schema.String;
    }
  >,
  import("effect/Cause").YieldableError
>;
export declare class CatalogDependencyResolutionError extends CatalogDependencyResolutionError_base {
  get message(): string;
}
/**
 * Resolve `catalog:` dependency specs using the workspace catalog.
 *
 * Pure function: returns a new record with every `catalog:…` value replaced by
 * the concrete version string found in `catalog`. Throws on missing entries.
 */
export declare function resolveCatalogDependencies(
  dependencies: Record<string, string>,
  catalog: Record<string, string>,
  workspacePackage: string,
): Record<string, string>;
export {};
