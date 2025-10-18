import { RpcComponent, RpcComponentServer } from "./rpc-components/server";
import { useEffect, useReducer, useState } from "./rpc-components/hooks";

/**
 * Server side code for the counter
 */
export class UIEntrypoint extends RpcComponentServer {
    private sessionItems: Array<{ favorited: boolean; title: string; description: string }> = [
        { favorited: false, title: "Alpha", description: "First card in the list." },
        { favorited: false, title: "Bravo", description: "Second card with additional details." },
        { favorited: false, title: "Charlie", description: "A descriptive third card." },
        { favorited: false, title: "Delta", description: "Contains example server-side data." },
        { favorited: false, title: "Echo", description: "Stubbed content for preview." },
        { favorited: false, title: "Foxtrot", description: "Useful placeholder information." },
        { favorited: false, title: "Golf", description: "Another item rendered via RPC." },
        { favorited: false, title: "Hotel", description: "Items fetched on the server." },
        { favorited: false, title: "India", description: "Demonstrates server-rendered UI." },
        { favorited: false, title: "Juliet", description: "More data to fill the list." },
        { favorited: false, title: "Kilo", description: "Consistent placeholder description." },
        { favorited: false, title: "Lima", description: "Final example item." },
        { favorited: false, title: "Mike", description: "Final example item." },
        { favorited: false, title: "November", description: "Final example item." },
        { favorited: false, title: "Oscar", description: "Final example item." },
        { favorited: false, title: "Hotel", description: "Items fetched on the server." },
        { favorited: false, title: "India", description: "Demonstrates server-rendered UI." },
        { favorited: false, title: "Juliet", description: "More data to fill the list." },
        { favorited: false, title: "Kilo", description: "Consistent placeholder description." },
        { favorited: false, title: "Lima", description: "Final example item." },
    ]

    constructor(public env: Env) {
        super()
    }

    @RpcComponent()
    async SimpleDiv() {
        return <div>Simple div</div>
    }

    @RpcComponent()
    async CardList() {
        const [count, reducerRerender] = useReducer(x => x + 1, 0)

        console.log("render: ", count)

        const items = await this.getStubbedItems()
        return <div className="card-list" role="list">
            {items.map((item, id) => {
                const { favorited, title, description, imageUrl } = item
                return (
                    <div key={id} className="card" role="listitem">
                        <img className="card-img" src={imageUrl} alt={title} loading="lazy" />
                        <div className="card-title">{title}</div>
                        <div className="card-desc">{description}</div>
                        <button onClick={(e) => {
                            console.log(`Clicked favorite on the server (${e.clientX}, ${e.clientY})`)
                            this.sessionItems[id].favorited = !this.sessionItems[id].favorited
                            console.log("pushing rerender")
                            reducerRerender()
                        }}>
                            {favorited ? "Unfavorite" : "Favorite"}
                        </button>
                        <button onClick={(e) => {
                            console.log(`Clicked remove on the server (${e.clientX}, ${e.clientY})`)
                            this.sessionItems.splice(id, 1)
                            reducerRerender()
                        }}>
                            Remove
                        </button>
                    </div>
                )
            })}
        </div>
    }

    private async getStubbedItems(): Promise<Array<{ favorited: boolean; title: string; description: string; imageUrl: string }>> {
        // Simulate latency of initial fetch
        const items = this.sessionItems.map((item, id) => ({ ...item, imageUrl: `https://picsum.photos/seed/${encodeURIComponent(id)}/300` }))
        // simulate per-item latency for variety
        return items
    }

    @RpcComponent()
    async Counter() {
        const [count, setCount] = useState(0)

        return <div>
            <div>Count: {count}</div>
            <button onClick={() => setCount(count + 1)}>Increment</button>
        </div>
    }

    @RpcComponent()
    async Clock() {
        const [count, setCount] = useState(0)

        useEffect(() => {
            const interval = setInterval(() => {
                console.log("clocked!")
                setCount(c => c + 1)  // Use functional form to get latest count
            }, 1000)
            return () => clearInterval(interval)
        }, [])

        console.log("rerendering!", count)

        return <div>
            <div>Clock: {count}</div>
        </div>
    }
}