import { describe, expect, test } from "vitest";
import {
    bucket,
    downloadUrl,
    IMMUTABLE,
    photoUrl,
    exists,
    get,
    keys,
    list,
    objectSize,
    put,
    removePrefix,
    s3,
    signerFor,
    uploadUrl,
} from "./storage.ts";

describe("storage", () => {
    test("uses the test bucket", () => {
        expect(bucket).toBe("linger-test");
    });

    test("keys follow the layout", () => {
        expect(keys.cover("e1")).toBe("events/e1/cover.jpg");
        expect(keys.shot("e1", "s1", "thumb")).toBe("events/e1/shots/s1/thumb.jpg");
        expect(keys.shotFolder("e1", "s1")).toBe("events/e1/shots/s1/");
    });

    test("a presigned PUT and a short-lived GET round-trip a file", async () => {
        const key = "events/storage-test/shots/a/original.jpg";
        const url = await uploadUrl(key);
        const put = await fetch(url, {
            method: "PUT",
            body: new Uint8Array([1, 2, 3]),
            headers: { "content-type": "image/jpeg" },
        });
        expect(put.status).toBe(200);
        expect(await exists(key)).toBe(true);
        expect(await objectSize(key)).toBe(3);
        const signed = await downloadUrl(key, 60);
        expect(signed).toMatch(/X-Amz-Expires=60/);
        expect(Array.from(new Uint8Array(await (await fetch(signed)).arrayBuffer()))).toEqual([
            1, 2, 3,
        ]);
        const forged = await fetch(signed.replace(/X-Amz-Signature=\w+/, "X-Amz-Signature=00"));
        expect(forged.ok).toBe(false);
    });

    test("a photo URL is the same all hour, is valid, and is served to be cached", async () => {
        const key = `test/photo-${Date.now()}.jpg`;
        await put(key, Buffer.from([4, 5, 6]), IMMUTABLE);
        const hour = Math.floor(Date.now() / 3_600_000) * 3_600_000;
        const early = await photoUrl(key, hour + 60_000);
        expect(await photoUrl(key, hour + 3_500_000)).toBe(early);
        expect(await photoUrl(key, hour + 3_700_000)).not.toBe(early);
        const res = await fetch(await photoUrl(key));
        expect(res.status).toBe(200);
        expect(res.headers.get("cache-control")).toBe(IMMUTABLE);
    });

    test("a signed upload only takes a JPEG content type", async () => {
        const key = "events/storage-test/cover.jpg";
        const url = await uploadUrl(key);
        for (const type of ["text/html", "image/png"]) {
            const res = await fetch(url, {
                method: "PUT",
                body: "<p>hi</p>",
                headers: { "content-type": type },
            });
            expect(res.ok).toBe(false);
        }
        expect(await objectSize(key)).toBeNull();
    });

    test("removePrefix deletes everything under a folder", async () => {
        await put("events/storage-test-2/cover.jpg", Buffer.from("a"));
        await put("events/storage-test-2/shots/x/thumb.jpg", Buffer.from("b"));
        expect((await get("events/storage-test-2/cover.jpg")).toString()).toBe("a");
        expect(await removePrefix("events/storage-test-2/")).toBe(2);
        expect(await list("events/storage-test-2/")).toEqual([]);
        expect(await exists("events/storage-test-2/cover.jpg")).toBe(false);
    });

    test("S3_PUBLIC_ENDPOINT moves signed URLs to an address devices can reach", async () => {
        expect(signerFor({})).toBe(s3);
        const lan = signerFor({ S3_PUBLIC_ENDPOINT: "http://127.0.0.1:8174" });
        const key = "events/storage-test/public.jpg";
        await put(key, Buffer.from("public"));
        const url = await downloadUrl(key, 60, lan);
        expect(url.startsWith("http://127.0.0.1:8174/")).toBe(true);
        const res = await fetch(url);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("public");
        await removePrefix(key);
    });
});
