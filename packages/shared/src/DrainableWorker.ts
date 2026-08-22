/**
 * DrainableWorker - A queue-based worker that exposes a `drain()` effect.
 *
 * Wraps the common `Queue.unbounded` + `Effect.forever` pattern and adds
 * a signal that resolves when the queue is empty **and** the current item
 * has finished processing. This lets tests replace timing-sensitive
 * `Effect.sleep` calls with deterministic `drain()`.
 *
 * @module DrainableWorker
 */
import * as Scope from "effect/Scope";
import * as Effect from "effect/Effect";
import * as TxQueue from "effect/TxQueue";
import * as TxRef from "effect/TxRef";

export interface DrainableWorker<A> {
  /**
   * Enqueue a work item and track it for `drain()`.
   *
   * This wraps `Queue.offer` so drain state is updated atomically with the
   * enqueue path instead of inferring it from queue internals.
   */
  readonly enqueue: (item: A) => Effect.Effect<void>;

  /**
   * Resolves when the queue is empty and the worker is idle (not processing).
   */
  readonly drain: Effect.Effect<void>;
}

interface KeyedDrainableWorkerState<K, A> {
  readonly pendingByKey: Map<K, ReadonlyArray<A>>;
  readonly activeKeys: Set<K>;
  readonly outstanding: number;
}

/**
 * Create a drainable worker that processes items from an unbounded queue.
 *
 * The worker is forked into the current scope and will be interrupted when
 * the scope closes. A finalizer shuts down the queue.
 *
 * @param process - The effect to run for each queued item.
 * @returns A `DrainableWorker` with `queue` and `drain`.
 */
export const makeDrainableWorker = <A, E, R>(
  process: (item: A) => Effect.Effect<void, E, R>,
): Effect.Effect<DrainableWorker<A>, never, Scope.Scope | R> =>
  Effect.gen(function* () {
    const queue = yield* Effect.acquireRelease(TxQueue.unbounded<A>(), TxQueue.shutdown);
    const outstanding = yield* TxRef.make(0);

    yield* TxQueue.take(queue).pipe(
      Effect.tap((a) =>
        Effect.ensuring(
          process(a),
          TxRef.update(outstanding, (n) => n - 1),
        ),
      ),
      Effect.forever,
      Effect.forkScoped,
    );

    const drain: DrainableWorker<A>["drain"] = TxRef.get(outstanding).pipe(
      Effect.tap((n) => (n > 0 ? Effect.txRetry : Effect.void)),
      Effect.tx,
    );

    const enqueue = (element: A): Effect.Effect<boolean, never, never> =>
      TxQueue.offer(queue, element).pipe(
        Effect.tap(() => TxRef.update(outstanding, (n) => n + 1)),
        Effect.tx,
      );

    return { enqueue, drain } satisfies DrainableWorker<A>;
  });

/** Processes different keys concurrently while preserving FIFO ordering within each key. */
export const makeKeyedDrainableWorker = <K, A, E, R>(options: {
  readonly concurrency: number;
  readonly key: (item: A) => K;
  readonly process: (item: A) => Effect.Effect<void, E, R>;
}): Effect.Effect<DrainableWorker<A>, never, Scope.Scope | R> =>
  Effect.gen(function* () {
    const readyKeys = yield* Effect.acquireRelease(TxQueue.unbounded<K>(), TxQueue.shutdown);
    const stateRef = yield* TxRef.make<KeyedDrainableWorkerState<K, A>>({
      pendingByKey: new Map(),
      activeKeys: new Set(),
      outstanding: 0,
    });

    const finish = (key: K) =>
      TxRef.modify(stateRef, (state) => {
        const activeKeys = new Set(state.activeKeys);
        activeKeys.delete(key);
        return [
          state.pendingByKey.has(key),
          {
            ...state,
            activeKeys,
            outstanding: state.outstanding - 1,
          },
        ] as const;
      }).pipe(
        Effect.flatMap((hasPendingWork) =>
          hasPendingWork ? TxQueue.offer(readyKeys, key) : Effect.void,
        ),
        Effect.tx,
        Effect.asVoid,
      );

    const processNext = TxQueue.take(readyKeys).pipe(
      Effect.flatMap((key) =>
        TxRef.modify(stateRef, (state) => {
          const pending = state.pendingByKey.get(key);
          const item = pending?.[0];
          if (pending === undefined || item === undefined) {
            return [undefined, state] as const;
          }

          const pendingByKey = new Map(state.pendingByKey);
          if (pending.length === 1) {
            pendingByKey.delete(key);
          } else {
            pendingByKey.set(key, pending.slice(1));
          }

          const activeKeys = new Set(state.activeKeys);
          activeKeys.add(key);
          return [
            { key, item },
            { ...state, pendingByKey, activeKeys },
          ] as const;
        }).pipe(Effect.tx),
      ),
      Effect.flatMap((next) =>
        next === undefined
          ? Effect.void
          : Effect.ensuring(options.process(next.item), finish(next.key)),
      ),
      Effect.forever,
    );

    const concurrency = Math.max(1, Math.floor(options.concurrency));
    yield* Effect.forEach(
      Array.from({ length: concurrency }),
      () => Effect.forkScoped(processNext),
      {
        discard: true,
      },
    );

    const enqueue: DrainableWorker<A>["enqueue"] = (item) => {
      const key = options.key(item);
      return TxRef.modify(stateRef, (state) => {
        const existing = state.pendingByKey.get(key);
        const pendingByKey = new Map(state.pendingByKey);
        pendingByKey.set(key, existing === undefined ? [item] : [...existing, item]);
        return [
          existing === undefined && !state.activeKeys.has(key),
          {
            ...state,
            pendingByKey,
            outstanding: state.outstanding + 1,
          },
        ] as const;
      }).pipe(
        Effect.flatMap((shouldOffer) =>
          shouldOffer ? TxQueue.offer(readyKeys, key) : Effect.void,
        ),
        Effect.tx,
        Effect.asVoid,
      );
    };

    const drain: DrainableWorker<A>["drain"] = TxRef.get(stateRef).pipe(
      Effect.tap((state) => (state.outstanding > 0 ? Effect.txRetry : Effect.void)),
      Effect.tx,
      Effect.asVoid,
    );

    return { enqueue, drain } satisfies DrainableWorker<A>;
  });
