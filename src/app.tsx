import "./polyfills";
import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";
import type { UIEntrypoint } from "./ui-server";
import { useRpcContext, RpcProvider, useRpc } from "./rpc-components/useRpc";
import { RpcSuspense } from "./rpc-components/client";
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

function CodeSnippet({ code }: { code: string }) {
    return (
        <div className="code-snippet-wrapper">
            <button className="copy-button" onClick={() => navigator.clipboard.writeText(code)}>Copy</button>
            <SyntaxHighlighter
                language="tsx"
                style={oneLight}
                customStyle={{
                    margin: 0,
                    padding: '16px',
                    fontSize: '11px',
                    lineHeight: '1.5',
                    border: '1px solid #000',
                    borderRadius: 0,
                    background: '#fafafa',
                    width: '100%',
                    maxWidth: '100%',
                    display: 'block',
                    overflow: 'hidden',
                    whiteSpace: 'pre-wrap',
                    wordWrap: 'break-word',
                    wordBreak: 'break-word',
                    boxSizing: 'border-box'
                }}
                PreTag="pre"
                CodeTag="code"
                wrapLines={true}
                wrapLongLines={true}
            >
                {code}
            </SyntaxHighlighter>
        </div>
    );
}

type ConsoleMessage = {
    timestamp: Date;
    data: string;
    formatted?: string;
    messageType?: string;
};

function MessageConsole({ ws }: { ws: WebSocket }) {
    const [messages, setMessages] = useState<ConsoleMessage[]>([]);
    const contentRef = useRef<HTMLDivElement>(null);
    const MAX_MESSAGES = 100;
    
    // Parse and format React serialized components
    const formatReactComponent = (obj: any, depth = 0): string => {
        if (!obj || typeof obj !== 'object') return '';
        
        if (obj.__reactSerialized && obj.type) {
            const indent = '  '.repeat(depth);
            const className = obj.props?.className ? ` className="${obj.props.className}"` : '';
            
            // Count children
            let childrenCount = 0;
            if (obj.props?.children) {
                if (Array.isArray(obj.props.children)) {
                    // Flatten nested arrays and filter out falsy values
                    const flatten = (arr: any[]): any[] => {
                        return arr.reduce((acc, item) => {
                            if (Array.isArray(item)) {
                                return acc.concat(flatten(item));
                            }
                            return acc.concat(item);
                        }, []);
                    };
                    childrenCount = flatten(obj.props.children).filter(c => c != null).length;
                } else {
                    childrenCount = 1;
                }
            }
            
            if (childrenCount > 0) {
                return `${indent}<${obj.type}${className}> (${childrenCount} ${childrenCount === 1 ? 'child' : 'children'}) </${obj.type}>`;
            } else {
                return `${indent}<${obj.type}${className} />`;
            }
        }
        return '';
    };
    
    // Attach event listener to WebSocket
    useEffect(() => {
        const handler = (event: MessageEvent) => {
            try {
                const parsed = JSON.parse(event.data);
                
                // Only process "push" messages
                if (Array.isArray(parsed) && parsed[0] === 'push') {
                    let formatted = '';
                    
                    // Extract the component from the pipeline structure
                    // Structure: ["push", ["pipeline", -1, [], [component]]]
                    if (Array.isArray(parsed[1]) && parsed[1][0] === 'pipeline') {
                        const components = parsed[1][3]; // The array of components
                        if (Array.isArray(components)) {
                            formatted = components
                                .map(comp => formatReactComponent(comp))
                                .filter(Boolean)
                                .join('\n');
                        }
                    }
                    
                    setMessages(prev => {
                        const newMessages = [
                            ...prev,
                            {
                                timestamp: new Date(),
                                data: event.data,
                                formatted: formatted || undefined,
                                messageType: 'push'
                            }
                        ];
                        // Keep only the last MAX_MESSAGES
                        return newMessages.slice(-MAX_MESSAGES);
                    });
                }
            } catch (e) {
                // Ignore parse errors or non-push messages
            }
        };
        
        ws.addEventListener('message', handler);
        
        return () => {
            ws.removeEventListener('message', handler);
        };
    }, [ws]);
    
    // Auto-scroll to bottom when new messages arrive
    useEffect(() => {
        if (contentRef.current) {
            contentRef.current.scrollTop = contentRef.current.scrollHeight;
        }
    }, [messages]);
    
    const formatTimestamp = (date: Date) => {
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const seconds = date.getSeconds().toString().padStart(2, '0');
        const ms = date.getMilliseconds().toString().padStart(3, '0');
        return `${hours}:${minutes}:${seconds}.${ms}`;
    };
    
    return (
        <div className="message-console">
            <div className="console-header">
                <span className="console-title">WebSocket Messages ({messages.length})</span>
                <button className="console-clear-btn" onClick={() => setMessages([])}>Clear</button>
            </div>
            <div className="console-content" ref={contentRef}>
                {messages.length === 0 ? (
                    <div className="console-empty">No messages yet...</div>
                ) : (
                    messages.map((msg, idx) => (
                        <div key={idx} className="console-message">
                            <span className="console-timestamp">
                                [{formatTimestamp(msg.timestamp)}]
                            </span>
                            {msg.formatted ? (
                                <span className="console-data console-formatted">{msg.formatted}</span>
                            ) : (
                                <span className="console-data">{msg.data}</span>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

// Tab view components
function ClockView() {
    const { rpc, ws } = useRpc<UIEntrypoint>("/rpc")
    
    return (
        <div className="tab-content">
            <p><strong>RPC Components</strong> are a new method of rendering UI components on the server. The key difference from typical server rendering techniques is that <strong>RPC Components are interactive and stateful</strong>. Your server components are React.FCs that happen to live on a server. All you need to do is render those components within a special RpcSuspense boundary, <em>no bundling required</em>.</p>
            
            <p>Call hooks like you would in a client side React application. <strong>When state updates, the server proactively re-renders</strong> and pushes the updated component tree back to the client. Write server side code in your event handlers and RPC Components will transparently pipe browser events to your server.</p>

            <RpcSuspense deferFallback fallback={<p>Loading clock...</p>}>
                <rpc.Clock />
            </RpcSuspense>
            
            <MessageConsole 
                ws={ws}
            />
            
            <h2>Server</h2>
            <CodeSnippet code={`export class UIEntrypoint extends RpcComponentServer {
  constructor(public env: Env) {
    super()
  }
  
  @RpcComponent()
  async Clock() {
    const [count, setCount] = useState(0)
    
    useEffect(() => {
      const interval = setInterval(() => {
        setCount(c => c + 1)
      }, 1000)
      return () => clearInterval(interval)
    }, [])
    
    return <div className="counter-widget">
      <div className="counter-display">{count}s</div>
      <button onClick={() => setCount(0)}>Reset</button>
    </div>
  }
}`} />

            <h2>Client</h2>
            <CodeSnippet code={`function ClockView() {
  const rpc = useRpcContext<UIEntrypoint>()
  
  return (
    <RpcSuspense 
      deferFallback 
      fallback={<p>Loading clock...</p>}
    >
      <rpc.Clock />
    </RpcSuspense>
  )
}`} />
        </div>
    );
}

function SimpleCounter() {
    const { rpc, ws } = useRpc<UIEntrypoint>("/rpc");
    return (
        <>
            <h2>Simple suspense, no defer fallback</h2>
            <RpcSuspense fallback={
                <div className="counter-widget">
                    <div className="counter-display">...</div>
                    <button disabled>+</button>
                </div>
            }>
                {/* @ts-ignore */}
                <rpc.Counter />
            </RpcSuspense>
            <CodeSnippet code={`@RpcComponent()
async Counter() {
  const [count, setCount] = useState(0)
  
  return <div className="counter-widget">
    <div className="counter-display">{count}</div>
    <button onClick={() => {
      setCount(count + 1)
    }}>+</button>
  </div>
}`} />
            <MessageConsole ws={ws} />
        </>
    );
}

function DeferFallbackCounter() {
    const { rpc, ws } = useRpc<UIEntrypoint>("/rpc");
    return (
        <>
            <h2>Simple suspense, with defer fallback</h2>
            <RpcSuspense deferFallback fallback={<p>Loading counter...</p>}>
                <rpc.Counter />
            </RpcSuspense>
            <CodeSnippet code={`@RpcComponent()
async Counter() {
  const [count, setCount] = useState(0)
  
  return <div className="counter-widget">
    <div className="counter-display">{count}</div>
    <button onClick={() => {
      setCount(count + 1)
    }}>+</button>
  </div>
}`} />
            <MessageConsole ws={ws} />
        </>
    );
}

function ServerLoadingCounter() {
    const { rpc, ws } = useRpc<UIEntrypoint>("/rpc");
    return (
        <>
            <h2>Defer fallback, with server side loading state</h2>
            <RpcSuspense deferFallback fallback={<p>Loading counter...</p>}>
                <rpc.CounterServerLoading />
            </RpcSuspense>
            <CodeSnippet code={`@RpcComponent()
async CounterServerLoading() {
  const [loading, setLoading] = useState(false)
  const [count, setCount] = useState(0)
  
  return <div className="counter-widget">
    <div className="counter-display">
      {loading ? "..." : count}
    </div>
    <button onClick={() => {
      setLoading(true)
      setTimeout(() => {
        setCount(count + 1)
        setLoading(false)
      }, 100)
    }}>+</button>
  </div>
}`} />
            <MessageConsole ws={ws} />
        </>
    );
}

function ClientHandlerCounter() {
    const { rpc, ws } = useRpc<UIEntrypoint>("/rpc");
    return (
        <>
            <h2>Defer fallback, with client side handler</h2>
            <RpcSuspense deferFallback fallback={<p>Loading counter...</p>} ctx={{ clientValue: 2 }}>
                {/* @ts-ignore idk these errors are strange... */}
                <rpc.CounterClientClick />
            </RpcSuspense>
            <CodeSnippet code={`@RpcComponent()
async CounterClientClick() {
  const [count, setCount] = useState(0)
  
  return <div className="counter-widget">
    <div className="counter-display">{count}</div>
    <button onClick={client(
      async (ctx: { clientValue: number }, deps) => {
        await deps.setCount(c => c + ctx.clientValue)
      }, 
      { count, setCount }
    )}>+</button>
  </div>
}`} />
            <MessageConsole ws={ws} />
        </>
    );
}

function CountersView() {
    return (
        <div className="tab-content">
            <h1>Counters</h1>
            <SimpleCounter />
            <DeferFallbackCounter />
            <ServerLoadingCounter />
            <ClientHandlerCounter />
        </div>
    );
}

function CardListView() {
    const { rpc, ws } = useRpc<UIEntrypoint>("/rpc");
    return (
        <div className="tab-content">
            <h1>RPC Components</h1>
            <div style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto', marginBottom: '12px' }}>
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
            
            <MessageConsole 
                ws={ws}
            />
        </div>
    );
}
function App() {
    const [activeTab, setActiveTab] = useState("clock");

    const tabs = [
        { id: "clock", label: "RPC Components", component: ClockView },
        { id: "counters", label: "Counters", component: CountersView },
        { id: "cards", label: "Cards", component: CardListView },
    ];

    const ActiveComponent = tabs.find(tab => tab.id === activeTab)?.component || CardListView;

    return (
        <div className="container">
            <div className="tab-view">
                <div className="tab-bar">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            className={`tab-button ${activeTab === tab.id ? "active" : ""}`}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
                <div className="tab-content-wrapper">
                    <ActiveComponent />
                </div>
            </div>
        </div>
    );
}
const root = createRoot(document.getElementById("root")!);
root.render(<App />);

