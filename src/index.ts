import { newWorkersRpcResponse } from "capnweb";
import { UIEntrypoint } from "./ui-server";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname.startsWith("/rpc")) {
      // allow cors
      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      }
      if (req.method === "OPTIONS") {
        return new Response("OK", { headers: corsHeaders })
      }
      const entrypoint = new UIEntrypoint(env)
      console.log(entrypoint)
      return newWorkersRpcResponse(req, entrypoint);
    }

    return new Response("Not found", { status: 404 })
  }
}