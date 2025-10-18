# RPC Components - Server side UI interactivity

Demo: https://rpc-components.cmsparks.workers.dev/

RPC Components are a new method of rendering UI components on the server. The key difference, is that these components are interactive and stateful.

RPC Components are a different implementation of a similar idea to RSC. However, instead of using a bundler to separate server and client code at build time, they use RPC at runtime. Your server components are React.FCs that happen to live on a server, with interactivity and state. When a client needs to render a component, it calls that function over RPC. When an event handler fires, that's another RPC call. When state updates, the server proactively re-renders (WITHOUT the user needing to fetch!) and sends the new component tree back.

The implementation is straightforward. Capnweb serializes the components (it can transmit functions over the wire, which matters for event handlers and state updates). A special RpcSuspense boundary handles the async nature of remote calls (it functions like a normal Suspense + Lazy component under the hood). The server keeps track of rendered components and their associated resolver functions, so it can push updates when state changes. No bundler integration needed, no framework required (you can drop RPC components into an existing React app, even if it's a different framework!).

## User facing API

The RpcComponents class is a subclass of RpcTarget, which let's you define Components that are exposed remotely to the client. You define these, just like you would a typical React.FC, but they are methods instead. The server exposes it's own hooks, which dispatch rerenders to the React client transparently.

Server
```tsx
import { RpcComponents } from "rpc-components"
import { useState } from "rpc-components/hooks"

class UI extends RpcComponents {
    // Stateful and interactive server rendered component!
    @RpcComponent
    ServerComponent(props: { foo: string }) {
        // You can use hooks like useState on the server!
        const [state, setState] = useState(false)

        return <>
            <div>hello {props.foo}</div>
            <button onClick={function(e: MouseEvent) {
                // We can access the MouseEvent that triggered this function on the server side!
                console.log(`Clicked at (${e.clientX}, ${e.clientY})`)
                setState(true) // <- this triggers a rerender of the RpcComponent
            }}>click me</button>
        </>
    }
}
```

On the client, you can render server components as normal React components, wrapped in an RpcSuspense boundary. This acts like a typical Suspense boundary, but it also attempts to resolve RPC components in the background.

Client
```tsx
function ClientComponent() {
    const rpc = useRpcContext<UI>()
    return (
        <RpcSuspense deferFallback fallback={<p>Loading...</p>}>
            <rpc.ServerComponent foo="bar" />
        </RpcSuspense>
    )
}
```

## Internals

### RpcComponent

RpcComponent acts as our Entrypoint for RPC components. It extends RpcTarget, and stores state related to components being rendered. To a user, calling methods on the class looks like a typical React.FC, but internally we store some state related to hooks and component rendering. 

For any method with the @RpcComponent method decorator, we add two additional parameters to the front of the function: an id for the component, and a reresolver function. This is used to push state updates back to the client without any additional roundtrips!

```tsx

export class RpcComponentServer extends RpcTarget {
    components: Record<string, ComponentData> = {}

    constructor() {
        super()
    }

    useLifecycle() {
        const store = this.getStore()
        return {
            update: () => this.pushRerender(store.id),
        }
    }

    private getStore(): { this: RpcComponentServer, id: string } {
        const store = asl.getStore()
        if (!store) {
            throw new Error("No ID found")
        }
        return store
    }

    // Imperatively push a rerender for a component
    // You shouldn't use this. Instead use the included useState hook
    private async pushRerender(id: string) {
        const component = this.components[id]
        if (!component) throw new Error("Tried to rerender component that doesn't exist")
        
        // Reset hook index before re-rendering so hooks are read from the start
        component.currentHookIndex = 0
        
        const componentFunction = this[component.component as keyof this] as Function
        try {
            const componentRes = await componentFunction.call(this, id, component.reresolve, ...component.args)
            await component.reresolve(componentRes)
        } catch (e) {
            console.error("Failed to rerender component", id, e)
        }
    }
}
```

### RpcSuspense

RpcSuspense is a Suspense boundary that attempts to resolve RPC components in the background.

```tsx
export function RpcSuspense(props: {
    deferFallback?: boolean,
    fallback: React.ReactNode,
    children: React.ReactNode
}) {
    const resolvedChildren = Children.toArray(props.children).map(function(child, i) {
        if (isValidElement(child)) {
            // if the child is an RPC component, let's attempt to resolve it
            if (child.type === 'function') {
                // ...
            }
        }
    })

    return <Suspense fallback={props.fallback}>
        {resolvedChildren}
    </Suspense>
}
```


### Component resolution

Resolve an RPC component via React.lazy() so it works with Suspense.

React docs recommend not abusing lazy like this because lazy is intended to be used at the top level to lazy load imports, but it works fine for this use case. 

From my (uninformed) reading of the react source code, server components just end up being wrapped by a lazy component anyways under the hood: https://github.com/facebook/react/blob/main/packages/react-server/src/ReactFlightServer.js#L1514

```tsx
/**
 * Resolve an RPC component
 * @param entrypointFn React FC on RPC entrypoint
 * @returns 
 */
function resolveRpcComponent(
    // TODO: improve the typing here
    entrypointFn: any,
    boundProps?: Record<string, unknown>,
    deferFallback?: boolean,
): React.FC {
    const id = useId()
    const componentRef = useRef<React.FC | null>(null)

    return lazy(() => {
        // ...
    })
}
```

2. `componentResolvers`: When rendering a component, the client sends us an id for the RPC component it's rendering AND a reresolver function. This is used to push server side state updates back to the client without an additional roundtrip.


### Serialization

1. `makeSerializable(...)`: Capnweb handles serialization, but it can't serialize *everything*. We need to strip out unserializable properties (primarily `$$typeof`: Symbol('react....') attribute).
2. `unmakeSerializable(...)`: After Capnweb deserializes the component, we need to restore the items to their proper types. This primarily involves


#### TODOs
 * Fragments are broken :sad: 
 * Client side updates (primarily loading states, so we're not waiting for a rerender). client() currently works, but doesn't work well. Dependencies don't seem to be working 100% right.
 * Reimplement deferFallback in RpcSuspense, but make it good
 * Implement as many hooks as possible and make sure they're the exact same functionality/type signatures as the client side hooks. Currently I just threw the react internals at claude and asked it to implement something similar 
 * Callbacks might be leaky memory wise. We very likely don't adequately clean up callbacks.
