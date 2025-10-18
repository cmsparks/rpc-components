# RPC Components - Server side UI interactivity

Demo: https://rpc-components.cmsparks.workers.dev/

RPC Components are a new method of rendering UI components on the server. The key difference, is that these components are interactive and stateful.

React Server Components let you run component logic on the server and avoid shipping JavaScript to the client. The tradeoff is complexity: you need a framework like Next.js, bundler configuration that understands server/client boundaries, and a build step that splits your code appropriately.

RPC Components are a different implementation of the same idea. Instead of using a bundler to separate server and client code at build time, they use RPC at runtime. Your server components are React.FCs that happen to live on a server, with interactivity and state. When a client needs to render a component, it calls that function over RPC. When an event handler fires, that's another RPC call. When state updates, the server re-renders and sends the new component tree back.

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

RpcComponent acts as our Entrypoint for RPC components. It extends RpcTarget, and wraps every method on the class. To a user, calling methods on the class looks like a typical React.FC `function(props: { foo: string }) { return <div>hello {props.foo}</div> }`, but internally, we add two additional parameters to the front of the function: an id for the component, and a reresolver function. This is used to push state updates back to the client without any additional roundtrips!

```tsx
class RpcComponents extends RpcTarget {
    // Record of all RPC components rendered by the session with their associated resolver function
    componentReresolvers: Record<string, function(serializedComponent: object): void>
    storage = new AsyncLocalStorage()

    constructor() {

    }
}
```

### RpcSuspense

```tsx
export function RpcSuspense(props: {
    deferFallback?: boolean,
    fallback: React.ReactNode,
    children: React.ReactNode
}) {
    const resolvedChildren = Children.toArray(props.children).map(function(child, i) {
        if (isValidElement(child)) {
            // if the child is an RPC component, let's attempt to resolve it in the background
            if (child.type instanceof Function) {
                return resolveRpcComponent(child.type, child.props)
            }
        }
    })

    return <Suspense fallback={props.fallback}>
        {resolvedChildren}
    </Suspense>
}
```


### Component resolution

```tsx
function resolveRpcComponent(
  // TODO: improve the typing here
  entrypointFn: any,
  boundProps?: Record<string, unknown>,
  onResolved?: (component: React.FC) => void
): React.FC {
    const id = useId()
    const componentRef = useRef<React.FC | null>(null)
    const [, triggerResolve] = useReducer(x => x + 1, null)


    return lazy(async function() {
        const reresolve = (serializedComponent) => {
            const tree = deserializeComponent(desc);
            const Component: React.FC = () => <>{tree}</>;
            componentRef.current = Component
            triggerResolve()
        }

        const { propsNoFns, fnKeys, fnValues } = splitFunctionProps(boundProps ?? {})
        // reresolve is a hook passed to the entrypointFn. 
        // It lets our RPC component trigger state updates for ANY COMPONENT IN OUR RPC COMPONENT TREE!
        const desc = await (entrypointFn as any)(id, reresolve, { ...propsNoFns, __fnKeys: fnKeys }, ...fnValues)
        const tree = deserializeComponent(desc);
        const Component: React.FC = () => <>{tree}</>;
        return new Promise((resolve) => {
            resolve({ default: Component });
        })
    })
}
```

2. `componentResolvers`: When rendering a component, the client sends us an id for the RPC component it's rendering AND a reresolver function. This is used to push server side state updates back to the client without an additional roundtrip.


### Serialization

1. `makeSerializable(...)`: Capnweb handles serialization, but it can't serialize *everything*. We need to strip out unserializable properties (primarily `$$typeof`: Symbol('react....') attribute).
2. `unmakeSerializable(...)`: After Capnweb deserializes the component, we need to restore the items to their proper types. This primarily involves


#### TODOs
 * Fragments are broken :sad: 
 * Client side updates (primarily loading states, so we're not waiting for a rerender)
 * Reimplement deferFallback in RpcSuspense, but make it good
 * Implement as many hooks as possible and make sure they're the exact same functionality/type signatures as the client side hooks. Currently I just threw the react internals at claude and asked it to implement something similar 
 * Callbacks might be leaky memory wise. We very likely don't adequately clean up callbacks.
