import { test, expect } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Store } from "../src/store/store.ts"

test("real consumer store wrapper reads, updates, and reloads refactored protobuf state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "server-compat-"))
    const file = join(dir, "state.pb")
    try {
        const a = new Store(file, { count: 0, nested: { source: "original" } })
        expect(await a.map()).toEqual({ count: 0, nested: { source: "original" } })
        await Promise.all(Array.from({ length: 8 }, () => a.edit(current => {
            if (!current || typeof current !== "object" || Array.isArray(current)) throw new Error("Invalid current JSON state")
            return { ...current, count: Number(current.count) + 1 }
        })))
        expect(await a.read()).toEqual({ count: 8, nested: { source: "original" } })
        const b = new Store(file, { count: -1 })
        expect(await b.map()).toEqual({ count: 8, nested: { source: "original" } })
        expect((await readFile(file)).length).toBeGreaterThan(0)
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
})
