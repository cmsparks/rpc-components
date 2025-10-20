import { Children, isValidElement, lazy, Suspense, useId, useReducer, useRef, useState } from "react";
import { makeSerializable, unmakeSerializable } from "./serialize";

/**
 * Resolve an RPC component via React.lazy() so it works with Suspense.
 * 
 * React docs recommend not abusing lazy like this because lazy is 
 * intended to be used at the top level to lazy load imports, but
 * it works fine for this use case. 
 * 
 * From my (uninformed) reading of the react source code, server components 
 * just end up being wrapped by a lazy component anyways under the hood: 
 * https://github.com/facebook/react/blob/main/packages/react-server/src/ReactFlightServer.js#L1514
 *
 * BTW this is a pretty disgusting function that I have to rework so its only ~2-3 paths to resolve.
 * 
 * @param entrypointFn React FC on RPC entrypoint
 * @returns 
 */
function resolveRpcComponent(
    // TODO: improve the typing here
    entrypointFn: any,
    boundProps?: Record<string, unknown>,
    deferFallback?: boolean,
    ctx?: Record<string, unknown>,
): React.FC {
    const id = useId()
    const componentRef = useRef<React.FC | null>(null)
    const fetchStartedRef = useRef(false)
    const [resolveMode, triggerResolve] = useReducer((state, action) => {
        if (action === "ref") {
            return {
                mode: "ref",
                count: state.count + 1
            }
        } else {
            return {
                mode: "refetch",
                count: state.count
            }
        }
    }, { mode: "refetch", count: 0 })

    // reresolve is a hook passed to the entrypointFn. 
    // It lets our RPC component trigger state updates for ANY COMPONENT IN OUR RPC COMPONENT TREE!
    const reresolve = (serializedComponent: any) => {
        const tree = unmakeSerializable(serializedComponent, ctx);
        const Component: React.FC = () => <>{tree}</>;
        componentRef.current = Component
        triggerResolve("ref")
    }

    // If deferFallback is enabled and we have a cached component, return it directly (no lazy)
    if (deferFallback && componentRef.current) {
        // Start background resolution (only once)
        if (!fetchStartedRef.current && resolveMode.mode === "refetch") {
            fetchStartedRef.current = true
            entrypointFn(id, reresolve, boundProps ?? {}).then((desc: any) => {
                const tree = unmakeSerializable(desc, ctx);
                const Component: React.FC = () => <>{tree}</>;
                componentRef.current = Component
                fetchStartedRef.current = false
                triggerResolve("ref")
            })
        }
        // Return cached component directly without lazy wrapper
        return componentRef.current
    }

    return lazy(() => {
        // Async resolution for normal paths
        if (resolveMode.mode === "refetch") {
            return entrypointFn(id, reresolve, boundProps ?? {}).then((desc: any) => {
                const tree = unmakeSerializable(desc, ctx);
                const Component: React.FC = () => <>{tree}</>;
                componentRef.current = Component
                return { default: componentRef.current }
            })
        } else {
            // Using cached component, already a React.FC
            if (!componentRef.current) {
                throw new Error("Component ref is null in ref mode - this should not happen")
            }
            return Promise.resolve({ default: componentRef.current })
        }
    })
}

/**
 * Suspense boundary for RPC components
 * @param props.fallback Fallback to display while RPC components are loading
 * @param props.deferFallback If true, return the cached component immediately while resolving in the background
 * @param props.ctx Context to pass to RPC client calls
 * @param props.children Children to render
 * @returns 
 */
export function RpcSuspense(props: {
    fallback: React.ReactNode,
    deferFallback?: boolean,
    // TODO: rename to something that doesn't conflict with Context
    ctx?: Record<string, unknown>,
    children: React.ReactNode
}) {
    // Resolve RPC children
    const resolvedChildren = Children.toArray(props.children).map((child, i) => {
        if (isValidElement(child)) {
            const t = child.type as unknown;

            // This is an RPC component, we need to resolve it
            if (typeof t === "function") {
                const key = (child as any).key;
                const rawChildProps = (child as any).props || {}

                const serializableProps = makeSerializable(rawChildProps)

                // Pass deferFallback to resolveRpcComponent
                const LazyComp = resolveRpcComponent(t as any, serializableProps, props.deferFallback, props.ctx)
                const node = <LazyComp key={key} />
                return node
            }
        }
        return child;
    })

    return (
        <Suspense fallback={props.fallback}>
            {resolvedChildren}
        </Suspense>
    )
}