import type { Plugin } from "@opencode-ai/plugin"
import { handleUsageCommand, handleUsageSimpleCommand } from "./lib/usage-handler"
import { state } from "./lib/tracking/types"
import { addTokens } from "./lib/tracking/tracker"

export const TestPlugin: Plugin = async ({ client }) => {
    return {
        event: async ({ event }) => {
            // Send notification on session completion
            if (event.type === "message.updated") {
                try {
                    const sessionID = event.properties?.info.sessionID;
                    const info = event.properties?.info;
                    const app = client.app
                    await app.log({
                        body: {
                            service: "usage-plugin",
                            level: "debug",
                            message: "message.updated event received",
                            extra: { sessionID, role: info?.role },
                        },
                    })

                    if (sessionID && info?.role === "assistant" && info?.tokens) {
                        const { input, output, reasoning, cache } = info.tokens;
                        const app = client.app

                        await app.log({
                            body: {
                                service: "usage-plugin",
                                level: "debug",
                                message: "Tokens detected in event",
                                extra: { input, output, reasoning, cacheRead: cache?.read, cacheWrite: cache?.write },
                            },
                        })

                        if ((input ?? 0) > 0 || (output ?? 0) > 0) {
                            const provider = info.providerID || "unknown";
                            const model = info.modelID || "unknown";
                            const app = client.app

                            await app.log({
                                body: {
                                    service: "usage-plugin",
                                    level: "debug",
                                    message: "Adding tokens to session",
                                    extra: { provider, model },
                                },
                            })
                            state.currentSessionID = sessionID;

                            addTokens(
                                sessionID,
                                provider,
                                model,
                                {
                                    input: input ?? 0,
                                    output: output ?? 0,
                                    reasoning: reasoning ?? 0,
                                    cacheRead: cache?.read ?? 0,
                                    cacheWrite: cache?.write ?? 0,
                                },
                            );
                        } else {
                            const app = client.app

                            await app.log({
                                body: {
                                    service: "usage-plugin",
                                    level: "warn",
                                    message: "Zero or negative tokens - Ignoring",
                                    extra: { input, output, reasoning },
                                },
                            })
                        }
                    } else {
                        const app = client.app

                        await app.log({
                            body: {
                                service: "usage-plugin",
                                level: "debug",
                                message: "Event does not contain token data",
                                extra: { sessionID, role: info?.role },
                            },
                        })
                    }
                } catch (error) {
                    const app = client.app

                    await app.log({
                        body: {
                            service: "usage-plugin",
                            level: "error",
                                message: "Error in message.updated",
                            extra: { error: error instanceof Error ? error.message : String(error) },
                        },
                    })
                }
            }
        },
        config: async (opencodeConfig) => {
            opencodeConfig.command ??= {}
            opencodeConfig.command["usage"] = {
                template: "",
                description: "Shows token usage for all sessions by provider and model",
            }
            opencodeConfig.command["usage-simple"] = {
                template: "",
                description: "Shows Claude Code 5h/week usage % and reset countdown only",
            }
        },
        "command.execute.before": async (input, output) => {
            if (input.command === "usage") {
                try {
                    const app = client.app
                    await app.log({
                        body: {
                            service: "usage-plugin",
                            level: "info",
                            message: "/usage command executed",
                        },
                    })
                    await handleUsageCommand({
                        client,
                        sessionID: input.sessionID,
                        params: output,
                    })
                } catch (err) {
                    const app = client.app
                    await app.log({
                        body: {
                            service: "usage-plugin",
                            level: "error",
                            message: err instanceof Error ? err.message : String(err),
                        },
                    })
                }

                throw new Error("__USAGE_COMMAND_HANDLED__")
            }

            if (input.command === "usage-simple") {
                try {
                    const app = client.app
                    await app.log({
                        body: {
                            service: "usage-plugin",
                            level: "info",
                            message: "/usage-simple command executed",
                        },
                    })
                    await handleUsageSimpleCommand({
                        client,
                        sessionID: input.sessionID,
                        params: output,
                    })
                } catch (err) {
                    const app = client.app
                    await app.log({
                        body: {
                            service: "usage-plugin",
                            level: "error",
                            message: err instanceof Error ? err.message : String(err),
                        },
                    })
                }

                throw new Error("__USAGE_SIMPLE_COMMAND_HANDLED__")
            }
        }
    }
}

export default TestPlugin
