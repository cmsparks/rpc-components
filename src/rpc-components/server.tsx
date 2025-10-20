import { RpcStub, RpcTarget } from "capnweb"
import { AsyncLocalStorage } from "node:async_hooks"
import { makeSerializable, unmakeSerializable } from "./serialize"
import type { AnyHook } from "./hooks"

export const asl = new AsyncLocalStorage<{ this: RpcComponentServer, id: string }>()
type ComponentData = {
    component: string | symbol,
    args: any[],
    reresolve: RpcStub<(serializableComponent: any) => void>,
    currentHookIndex: number,
    hooks: Array<AnyHook>
}

/**
 * Class which exposes server components
 */
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

/**
 * Decorator which marks a method as an RPC component. 
 * The method being decorated should return valid React nodes.
 */
export function RpcComponent(): MethodDecorator {
    return function (
        target: Object,
        propertyKey: string | symbol,
        descriptor: PropertyDescriptor
    ) {
        const original = descriptor.value;
        if (typeof original !== "function") {
            throw new Error("@RpcComponent can only be applied to methods")
        }

        descriptor.value = async function (
            id: string,
            reresolve: RpcStub<(serializableComponent: any) => void>,
            ...args: any[]
        ) {
            // revive any serialized React props before calling the original method
            let revivedArgs = args.map((a) => unmakeSerializable(a))
            // @ts-ignore
            // Preserve existing hooks and state when updating component
            const existingComponent = this.components[id] as ComponentData

            (this as RpcComponentServer).components[id] = {
                component: propertyKey,
                args,
                reresolve: reresolve.dup(),
                // Preserve hooks state across re-renders
                hooks: existingComponent?.hooks || [],
                currentHookIndex: existingComponent?.currentHookIndex ?? 0
            }
            const result = await asl.run({ this: this as RpcComponentServer, id: id }, async () => {
                return await original.apply(this, revivedArgs)
            })
            // If already serialized via makeSerializable, pass through
            if (result && typeof result === "object" && (result as any).__reactSerialized === true) {
                return result
            }
            // Otherwise, serialize any returned React node
            return makeSerializable(result as any)
        }

        return descriptor;
    }
}

interface ClientSideFunction<T> {
    __reactSerializedHandler: true,
    clientBody: string,
    deps: T
}

/**
 * Run a function on the client from a server component.
 * 
 * This is useful for running functions that require client-side code, such as DOM manipulation,
 * event handling, utilizing client side data, etc. The function will be serialized and sent to
 * the client, where it will be executed in a Function(). 
 * 
 * IMPORTANT: This function has NO access to external state by default, and is only able to access 
 * the arguments passed to it via the server (serverDeps) OR client (ctx).
 * 
 * The client function will be called with the following arguments:
 * 
 * @param fn The client side context object
 *          (ctx: C, deps: T, ...args: Parameters<F>) => ReturnType<F>
 *          ctx: The client side context object, set on the RpcSuspense component
 *          deps: Server side dependencies, which were passed in below
 *          ...args: The arguments passed to the client function (i.e. MouseEvent if it's an onClick handler)
 * @param deps Server side dependencies to use when calling the function
 */
export function client<C, T, F extends (...args: any[]) => any>(fn: (ctx: C, serverDeps: T, ...args: Parameters<F>) => ReturnType<F>, serverDeps: T): F {
    const clientFunction: ClientSideFunction<T> = {
        __reactSerializedHandler: true,
        clientBody: fn.toString(),
        deps: serverDeps
    }
    // force cast so our types don't complain
    return clientFunction as unknown as F
}