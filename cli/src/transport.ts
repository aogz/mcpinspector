import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { findActualExecutable } from "spawn-rx";
import https from "node:https";
import nodeFetch from "node-fetch";

export type TransportOptions = {
  transportType: "sse" | "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  disableSSLVerification?: boolean;
};

function createStdioTransport(options: TransportOptions): Transport {
  let args: string[] = [];

  if (options.args !== undefined) {
    args = options.args;
  }

  const processEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      processEnv[key] = value;
    }
  }

  const defaultEnv = getDefaultEnvironment();

  const env: Record<string, string> = {
    ...defaultEnv,
    ...processEnv,
  };

  const { cmd: actualCommand, args: actualArgs } = findActualExecutable(
    options.command ?? "",
    args,
  );

  return new StdioClientTransport({
    command: actualCommand,
    args: actualArgs,
    env,
    stderr: "pipe",
  });
}

export function createTransport(options: TransportOptions): Transport {
  const { transportType } = options;

  try {
    if (transportType === "stdio") {
      return createStdioTransport(options);
    }

    // If not STDIO, then it must be either SSE or HTTP.
    if (!options.url) {
      throw new Error("URL must be provided for SSE or HTTP transport types.");
    }
    const url = new URL(options.url);

    // Create HTTPS agent with SSL verification disabled if requested
    const httpsAgent = options.disableSSLVerification
      ? new https.Agent({
          rejectUnauthorized: false,
        })
      : undefined;

    // Create custom fetch function if SSL verification is disabled
    const createCustomFetch = (httpsAgent?: https.Agent) => {
      if (!httpsAgent) {
        return undefined;
      }
      return async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        const fetchOptions: any = { ...init };
        fetchOptions.agent = (url: URL) => {
          if (url.protocol === "https:") {
            return httpsAgent;
          }
          return undefined;
        };
        return (await nodeFetch(
          input as any,
          fetchOptions,
        )) as unknown as Response;
      };
    };

    if (transportType === "sse") {
      const customFetch = createCustomFetch(httpsAgent);
      const transportOptions: any = {};
      if (options.headers) {
        transportOptions.requestInit = {
          headers: options.headers,
        };
      }
      if (customFetch) {
        transportOptions.eventSourceInit = {
          fetch: customFetch,
        };
      }
      return new SSEClientTransport(url, transportOptions);
    }

    if (transportType === "http") {
      const customFetch = createCustomFetch(httpsAgent);
      const transportOptions: any = {};
      if (options.headers) {
        transportOptions.requestInit = {
          headers: options.headers,
        };
      }
      if (customFetch) {
        transportOptions.fetch = customFetch;
      }
      return new StreamableHTTPClientTransport(url, transportOptions);
    }

    throw new Error(`Unsupported transport type: ${transportType}`);
  } catch (error) {
    throw new Error(
      `Failed to create transport: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
