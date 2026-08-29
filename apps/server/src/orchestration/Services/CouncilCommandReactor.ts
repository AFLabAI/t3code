import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface CouncilCommandReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class CouncilCommandReactor extends Context.Service<
  CouncilCommandReactor,
  CouncilCommandReactorShape
>()("t3/orchestration/Services/CouncilCommandReactor") {}
