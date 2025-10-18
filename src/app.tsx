import { createRoot } from "react-dom/client";
import "./styles.css";
import type { UIEntrypoint } from "./counter";
import { useRpcContext, RpcProvider } from "./rpc-components/useRpc";
import { RpcSuspense } from "./rpc-components/client";

function App() {
    const rpc = useRpcContext<UIEntrypoint>()

    return (
        <div className="container">
            <div className="counter-row">

                {/* local header */}
                <h1>List of items</h1>
                <RpcSuspense deferFallback fallback={<p>Loading clock...</p>}>
                    <h1>Server Rendered Clock</h1>
                    {/* @ts-ignore I have no idea why only the first rpc call shows a type error? */}
                    <rpc.Clock />
                </RpcSuspense>


                {/* suspense boundary for our RPC components */}
                <RpcSuspense deferFallback fallback={<p>Loading counter...</p>}>
                    <h1>Counter (defer fallback)</h1>
                    <rpc.Counter />
                </RpcSuspense>

                {/* suspense boundary for our RPC components */}
                <RpcSuspense fallback={<p>Loading counter...</p>}>
                    <h1>Counter (no defer fallback)</h1>
                    <rpc.Counter />
                </RpcSuspense>

                <RpcSuspense
                    deferFallback
                    fallback={
                        <p className="counter-value" aria-live="polite">???</p>
                    }
                >
                    <rpc.SimpleDiv />
                    <rpc.CardList />
                </RpcSuspense>
            </div>
        </div>
    );
}
const root = createRoot(document.getElementById("root")!);
root.render(
    <RpcProvider url={window.location.href.includes("localhost") ? `http://${window.location.host}/rpc` : `https://${window.location.host}/rpc`}>
        <App />
    </RpcProvider>
);

