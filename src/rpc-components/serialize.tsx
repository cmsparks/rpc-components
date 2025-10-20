import React from "react"

/**
 * This is a little vibe-smelly, but it works. Should replace with a better 
 * internal serialization mechanism
 * 
 * It might be preferable to use whatever format React Server Components 
 * uses under the hood for serializing components. But we want to take 
 * advantage of the features of capnweb (primarily bidirectionality).
 * 
 * I also don't really want to dig into React internals too much (Plus 
 * I will be fired if I use React internals...)
 */

/**
 * Make an object serializable by capnweb.
 * 
 * This handles:
 * * React elements
 * * Events (both DOM and Synthetic Events)
 * 
 * For each of these, we need to strip unserializable 
 * properties (e.g. DOM nodes, circular references, symbols, etc)
 * 
 * @param element item to make serializable (usually a React.Element)
 * @returns capnweb serializable object
 */
export function makeSerializable(element: any, onRpcCallback?: () => void): any {
    // Track seen objects to avoid circular structures
    const seen = new WeakSet<object>()

    // Narrow check for React SyntheticEvent and DOM Event
    function isDomEvent(val: any): boolean {
        return typeof Event !== 'undefined' && val instanceof Event
    }
    function isSyntheticEvent(val: any): boolean {
        return !!val && typeof val === 'object' && ('nativeEvent' in val) && ('isDefaultPrevented' in val) && ('isPropagationStopped' in val)
    }

    // TODO: claude wrote this, but we can rewrite to make it more comprehensive
    // 
    // Right now, it's just a simplistic filtering of parameters, so we don't run into errors when serialiing.
    // But we can probably do better to more fully reconstruct the event.
    function serializeEventTarget(t: any): any {
        if (!t || (typeof t !== 'object' && typeof t !== 'function')) return undefined
        const out: Record<string, unknown> = {}
        try { if (typeof (t as any).tagName === 'string') out.tagName = (t as any).tagName } catch {}
        try { if (typeof (t as any).nodeName === 'string' && !out.tagName) out.tagName = (t as any).nodeName } catch {}
        try { if (typeof (t as any).id === 'string') out.id = (t as any).id } catch {}
        try { if (typeof (t as any).name === 'string') out.name = (t as any).name } catch {}
        try {
            const v = (t as any).value
            if (v !== undefined && typeof v !== 'object') out.value = v
        } catch {}
        try {
            if (typeof (t as any).checked !== 'undefined') out.checked = !!(t as any).checked
        } catch {}
        try { if (typeof (t as any).type === 'string') out.type = (t as any).type } catch {}
        try { if (typeof (t as any).className === 'string') out.className = (t as any).className } catch {}
        try {
            const ds = (t as any).dataset
            if (ds && typeof ds === 'object') out.dataset = { ...ds }
        } catch {}
        return out
    }
    function serializeEvent(e: any): any {
        const out: Record<string, unknown> = { __reactSerializedEvent: true }
        const copyIf = (k: string) => {
            try {
                const v = e[k]
                if (v !== undefined && typeof v !== 'object') out[k] = v
            } catch {}
        }
        // Common Event fields
        copyIf('type')
        copyIf('timeStamp')
        copyIf('bubbles')
        copyIf('cancelable')
        copyIf('defaultPrevented')
        copyIf('eventPhase')
        // Mouse/Pointer related
        ;['clientX','clientY','pageX','pageY','screenX','screenY','button','buttons','detail','pointerId','pointerType','width','height','pressure','tiltX','tiltY'].forEach(copyIf)
        // Keyboard related
        ;['key','code','keyCode','altKey','ctrlKey','shiftKey','metaKey','repeat'].forEach(copyIf)
        // Targets
        try { out['target'] = serializeEventTarget(e.target) } catch {}
        try { out['currentTarget'] = serializeEventTarget(e.currentTarget) } catch {}
        return out
    }

    function clean(value: any, brand: boolean): any {
        // React element
        if (React.isValidElement(value)) {
            // If this is a function component, render it to its underlying element
            try {
                if (typeof (value as any).type === 'function') {
                    const rendered = (value as any).type((value as any).props)
                    return clean(rendered, brand)
                }
            } catch {
                // Fall through and serialize the raw element shape if invocation fails
            }
            const out: Record<string, unknown> = {}
            if (brand) {
                out["__reactSerialized"] = true
            }
            for (const [key, v] of Object.entries(value)) {
                // remove react internal keys that likely won't be able to be serialized
                if (!["$$typeof", "key", "_owner", "_store", "ref", "_source", "_self"].includes(key)) {
                    const cleaned = clean(v, false)
                    if (cleaned !== undefined) out[key] = cleaned
                }
            }
            return out
        }

        // Arrays – preserve as arrays
        if (Array.isArray(value)) {
            return value.map((v) => clean(v, false))
        }
        // Plain objects (including Events)
        if (value && typeof value === "object") {
            // Event handling: convert to a safe, shallow snapshot
            if (isDomEvent(value) || isSyntheticEvent(value)) {
                onRpcCallback?.()
                return serializeEvent(value)
            }

            // strip circular values
            if (seen.has(value)) return undefined
            seen.add(value)
            const out: Record<string, unknown> = {}
            for (const [k, v] of Object.entries(value)) {
                // recursively clean
                const cleaned = clean(v, false)
                if (cleaned !== undefined) out[k] = cleaned
            }
            return out
        }
        
        // Primitives / functions
        return value
    }
    const cleaned = clean(element, true)
    return cleaned
}

/**
 * Reverse of makeSerializable: takes the output (or its JSON string) and
 * reconstructs React elements using React.createElement(...).
 */
export function unmakeSerializable(input: any, ctx?: Record<string, unknown>): React.ReactNode {
    const desc = input

    function revive(value: any): any {
        if (value == null) return value
        // arrays
        if (Array.isArray(value)) return value.map(revive)
        // serialized element shape
        if (typeof value === 'object' && typeof (value as any).type === 'string' && 'props' in value) {
            const { type } = value as { type: string, props?: Record<string, unknown> }
            const rawProps = ((value as any).props ?? {}) as Record<string, unknown>
            const { children, ...rest } = rawProps
            const revivedProps: Record<string, unknown> = {}
            for (const [k, v] of Object.entries(rest)) {
                const r = revive(v)
                if (typeof r === 'function') {
                    // Wrap function props to sanitize their arguments (e.g., Events) before crossing RPC
                    revivedProps[k] = (...args: any[]) => {
                        const safeArgs = args.map((a) => makeSerializable(a as any))
                        return (r as any)(...safeArgs)
                    }
                } else {
                    revivedProps[k] = r
                }
            }
            const childArr = children === undefined ? [] : (Array.isArray(children) ? children : [children])
            const revivedChildren = childArr.map((c) => revive(c))
            return React.createElement(type as any, revivedProps, ...revivedChildren)
        }
        // plain object
        if (typeof value === 'object') {
            // Check if this is a serialized client-side function
            if (value.__reactSerializedHandler === true && 'clientBody' in value && 'deps' in value) {
                // Reconstruct the function from the serialized string
                const reconstructedFn = new Function("return " + value.clientBody) as Function
                // Revive and dup() deps ONCE when creating the function, not on every invocation
                // This ensures RPC stubs in deps get their own reference and won't be disposed
                const revivedDeps = revive(value.deps)
                // Return a wrapper that injects deps as the first argument
                return (...args: any[]) => {
                    ;(reconstructedFn())(ctx, revivedDeps, ...args)
                }
            }
            
            const out: Record<string, unknown> = {}
            for (const [k, v] of Object.entries(value)) {
                if (k === '__reactSerialized') continue
                out[k] = revive(v)
            }
            return out
        }

        // make sure we .dup() capnweb stubs
        // TODO: should clean this up
        if (typeof value === 'function') {
            if ("dup" in value) {
                return value.dup()
            }
        }

        // primitives
        return value
    }

    return revive(desc)
}

