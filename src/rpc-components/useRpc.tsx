import { newWebSocketRpcSession, RpcStub, type RpcTarget } from "capnweb"
import { Children, createContext, isValidElement, lazy, Suspense, useContext, useMemo, useRef } from "react"
import React from "react"

export type RetrySettings = boolean | number
export type RpcOptions<T extends RpcTarget> = {
    /**
     * On first connection to the RPC entrypoint
     */
    onStart: (entrypoint: RpcStub<T>) => void | Promise<void>,
    /**
     * Upon any (re)connection to the RPC entrypoint
     */
    onConnect: (entrypoint: RpcStub<T>) => void | Promise<void>,
    /**
     * true: infinite retries
     * number: number of retries
     * false: no retries
     */
    retry: RetrySettings,
    /**
     * Base delay between retries (exponential backoff)
     */
    retryDelay: number,
    /**
     * Called when the RPC connection is broken
     */
    onRpcBroken: (error: Error) => void,
    /**
     * Called when the RPC reconnection fails (after max retries)
     */
    onRpcFailed: () => void,
}

// This is a function (as opposed to a const) so we get valid type checking with the generic argument
function DEFAULT_OPTS<T extends RpcTarget>(): RpcOptions<T> {
    return {
        retry: 3,
        retryDelay: 500,
        onRpcBroken: () => { },
        onRpcFailed: () => { },
        onStart: (entrypoint: RpcStub<T>) => { },
        onConnect: (entrypoint: RpcStub<T>) => { },
    }
}

/**
 * Connect to a capnrpc endpoint and return the RPC stub and WebSocket
 * 
 * @param url Websocket RPC entrypoint URL
 * @param initOptions Entrypoint options for retries & lifecycle hooks
 * @returns Object containing rpc stub and WebSocket instance
 */
export function useRpc<T extends RpcTarget>(url: string, initOptions?: Partial<RpcOptions<T>>): { rpc: RpcStub<T>, ws: WebSocket } {
    const options: Required<RpcOptions<T>> = {
        ...DEFAULT_OPTS<T>(),
        ...initOptions,
    }

    // Convert URL to WebSocket scheme
    const wsUrl = useMemo(() => {
        let convertedUrl = url;
        
        // If relative path, construct full URL with proper WebSocket scheme
        if (url.startsWith('/')) {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            convertedUrl = `${protocol}//${window.location.host}${url}`;
        } 
        // If absolute URL with http/https, convert to ws/wss
        else if (url.startsWith('http://')) {
            convertedUrl = url.replace('http://', 'ws://');
        } else if (url.startsWith('https://')) {
            convertedUrl = url.replace('https://', 'wss://');
        }
        
        return convertedUrl;
    }, [url]);

    const ws = useMemo(() => {
        const ws = new WebSocket(wsUrl)
        return ws
    }, [wsUrl])

    const stubRef = useRef<RpcStub<T>>(newWebSocketRpcSession<T>(ws));
    const retriesRef = useRef<number>(0);

    (async () => {
        await options.onStart(stubRef.current)
        await options.onConnect(stubRef.current)
    })()

    stubRef.current.onRpcBroken(async (error) => {
        options.onRpcBroken(error)

        let retries: boolean | number = options.retry;
        while (retries) {
            const BASE_MS = options.retryDelay
            const attempt = retriesRef.current
            const expDelay = BASE_MS * Math.pow(2, attempt)
            const jitter = Math.floor(Math.random() * BASE_MS)
            const delay = expDelay + jitter
            console.log(`retrying connection in ${delay}ms (attempt ${attempt + 1})`)
            if (typeof retries === "number") {
                retries--
            }
            setTimeout(async () => {
                stubRef.current = newWebSocketRpcSession<T>(wsUrl)
                await options.onConnect(stubRef.current)
            }, delay)
        }
        options.onRpcFailed()
    })

    return { rpc: stubRef.current, ws }
}

// @ts-ignore
const RpcContext: React.Context<RpcStub<any>> = createContext<RpcStub<any>>(null)

/**
 * 
 * @param props.url: Websocket RPC entrypoint URL
 * @param props.initOptions: RPC options for retries & lifecycle hooks (See RpcOptions)
 * @param props.children: React children
 * @returns 
 */
export function RpcProvider<T extends RpcTarget>(props: { url: string, initOptions?: RpcOptions<T>, children: React.ReactNode }) {
    const stub = useRpc<T>(props.url, props.initOptions)
    return <RpcContext.Provider value={stub}>{props.children}</RpcContext.Provider>
}

/**
 * Get RPC stub from RPC context provider
 * 
 * @returns RPC stub
 */
export function useRpcContext<T extends RpcTarget>(): RpcStub<T> {
    const stub = useContext(RpcContext)
    if (!stub) {
        throw new Error("The value of RpcContext was not set. Was useRpcContext used within a valid RpcProvider?")
    }
    return stub as RpcStub<T>
}