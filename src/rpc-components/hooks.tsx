import type { ActionDispatch, AnyActionArg, useReducer as reactUseReducer } from "react"
import { asl } from "./server"

export interface Hook<S, A> {
    type: 'state'
    memoizedState: S
    reducer: (state: S, action: A) => S
    queue: A[]
}

export interface EffectHook {
    type: 'effect'
    effect: () => void | (() => void)
    deps: any[] | undefined
    cleanup?: () => void
    hasRun: boolean
}

export type AnyHook = Hook<any, any> | EffectHook

export const useReducer = <S, A extends AnyActionArg>(
    ...args: Parameters<typeof reactUseReducer<S, A>>
): ReturnType<typeof reactUseReducer<S, A>> => {
    const [reducer, initialArg] = args

    const store = asl.getStore()
    if (!store) {
        throw new Error("No ID found. Was the hook run inside of a server component?")
    }

    const { id, this: componentServer } = store
    const { update } = componentServer.useLifecycle()
    const component = componentServer.components[id]

    // Initialize hooks array if it doesn't exist
    if (!component.hooks) {
        component.hooks = []
        component.currentHookIndex = 0
    }

    // Get current hook index and increment for next hook call
    const hookIndex = component.currentHookIndex!
    component.currentHookIndex!++

    // Get or create the hook at this index
    let hook: Hook<S, A> = component.hooks[hookIndex] as unknown as Hook<S, A>

    if (!hook) {
        // Mount phase: initialize the hook
        // Compute initial state using init function if provided, otherwise use initialArg directly
        let initialState: S
        initialState = initialArg as S

        hook = {
            type: 'state',
            memoizedState: initialState,
            reducer: reducer as (state: S, action: A) => S,
            queue: []
        }
        component.hooks[hookIndex] = hook
    } else {
        // Update phase: process any queued actions
        hook.reducer = reducer as (state: S, action: A) => S // Update reducer in case it changed

        if (hook.queue.length > 0) {
            // Process all queued actions through the reducer
            let newState = hook.memoizedState
            for (const action of hook.queue) {
                // @ts-ignore TODO fix types with hooks
                newState = reducer(newState, action)
            }
            hook.memoizedState = newState
            hook.queue = []
        }
    }

    // Create dispatch function bound to this hook
    const dispatch = (action: A) => {
        // Get fresh reference to the hook
        const currentHook = component.hooks![hookIndex] as unknown as Hook<S, A>
        // Apply reducer to get new state
        const newState = currentHook.reducer(currentHook.memoizedState, action)
        // Only update if state actually changed
        if (!Object.is(newState, currentHook.memoizedState)) {
            currentHook.memoizedState = newState
            // Trigger component re-render (hook index will be reset at start of next render)
            update()
        }
    }

    // @ts-ignore
    return [hook.memoizedState, dispatch]
}

function reducer<T>(state: T, action: T | ((state: T) => T)) {
    if (typeof action === 'function') {
        // @ts-ignore
        return action(state);
    }
    return action;
}

export function useState<T>(initialState: T): [T, ActionDispatch<[action: T | ((state: T) => T)]>] {
    const [state, dispatch] = useReducer(reducer<T>, initialState);
    return [state, dispatch];
}

/**
 * Compare two dependency arrays for shallow equality
 */
function areDepsEqual(prevDeps: any[] | undefined, nextDeps: any[] | undefined): boolean {
    if (prevDeps === undefined || nextDeps === undefined) {
        return false
    }
    if (prevDeps.length !== nextDeps.length) {
        return false
    }
    for (let i = 0; i < prevDeps.length; i++) {
        if (!Object.is(prevDeps[i], nextDeps[i])) {
            return false
        }
    }
    return true
}

export function useEffect(effect: () => void | (() => void), deps?: any[]): void {
    const store = asl.getStore()
    if (!store) {
        throw new Error("No ID found. Was the hook run inside of a server component?")
    }

    const { id, this: componentServer } = store
    const component = componentServer.components[id]

    // Initialize hooks array if it doesn't exist
    if (!component.hooks) {
        component.hooks = []
        component.currentHookIndex = 0
    }

    // Get current hook index and increment for next hook call
    const hookIndex = component.currentHookIndex!
    component.currentHookIndex!++

    // Get or create the hook at this index
    let hook: EffectHook | undefined = component.hooks[hookIndex] as unknown as EffectHook | undefined

    if (!hook) {
        // Mount phase: initialize the effect hook
        hook = {
            type: 'effect',
            effect,
            deps,
            cleanup: undefined,
            hasRun: false
        }
        component.hooks[hookIndex] = hook

        // Queue the effect to run after render
        queueEffect(componentServer, id, hookIndex)
    } else {
        // Update phase: check if deps changed
        const depsChanged = !areDepsEqual(hook.deps, deps)

        if (depsChanged || deps === undefined) {
            // Run cleanup from previous effect
            if (hook.cleanup) {
                try {
                    hook.cleanup()
                } catch (e) {
                    console.error("Effect cleanup error:", e)
                }
            }

            // Update effect and deps
            hook.effect = effect
            hook.deps = deps
            hook.cleanup = undefined

            // Queue the effect to run after render
            queueEffect(componentServer, id, hookIndex)
        }
    }
}

/**
 * Queue an effect to run after the current render completes
 */
function queueEffect(componentServer: any, componentId: string, hookIndex: number) {
    // Use setImmediate or setTimeout to run effect after render
    setImmediate(() => {
        const component = componentServer.components[componentId]
        if (!component) return

        const hook = component.hooks?.[hookIndex] as unknown as EffectHook
        if (!hook) return

        try {
            const cleanup = hook.effect()
            if (typeof cleanup === 'function') {
                hook.cleanup = cleanup
            }
            hook.hasRun = true
        } catch (e) {
            console.error("Effect error:", e)
        }
    })
}